import type { ModelId } from './models';
import type { FromWorker, Segment, ToWorker } from './worker';

export type { Segment };

/**
 * The words, and where each phrase sits in the audio. `segments` is empty only
 * if Whisper returned no timestamps at all; `text` is always the whole thing.
 */
export type Transcript = {
  text: string;
  segments: Segment[];
  degenerate: boolean;
  noSpeech: boolean;
  /** The silence detector was there and did not work; nothing was skipped. */
  vadFailed: boolean;
};

export type Progress =
  | { stage: 'loading' }
  | { stage: 'working'; done: number; total: number };

export class ModelMissingError extends Error {}

/** Absolute, because paths inside a worker resolve against the worker file. */
const abs = (path: string) => new URL(path, document.baseURI).href;

/**
 * Owns the transcription worker. One job at a time; a laptop running Whisper
 * has nothing spare anyway. Live-caption windows ride the same queue but only
 * when it is empty: a caption computed a minute late is not a caption.
 */
export class Transcriber {
  private worker: Worker | null = null;
  private jobs = 0;
  /** Jobs handed over but not yet finished. Live jobs skip when this is set. */
  private running = 0;
  /** Live caption windows running right now; a caption needs its worker warm. */
  private liveJobs = 0;
  /** Jobs run one after another; the model holds state we must not share. */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * How the worker is made. Only tests pass anything: the real one loads
   * transformers.js and a model, which is not something a spec can wait for.
   */
  constructor(
    private makeWorker: () => Worker = () =>
      new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
  ) {}

  private get inFlight(): boolean {
    return this.running > 0;
  }

  /**
   * Runs `start` once everything already queued has finished.
   *
   * It takes a function rather than a promise, and that is the whole point.
   * `track(this.send(...))` evaluates the send first, and the send posts to the
   * worker synchronously inside its Promise executor — so the job reached the
   * worker before anything was chained, and the chain only sequenced when each
   * caller heard back. Two recordings finishing close together ran two
   * generations at once against one cached pipeline, which holds decoder state
   * between calls.
   */
  private track<T>(start: () => Promise<T>): Promise<T> {
    // Counted from the moment it is handed over, not from the moment it runs,
    // so a caption offered while something is merely queued is still dropped.
    this.running++;
    const done = this.queue.then(start).finally(() => {
      this.running--;
    });
    this.queue = done.catch(() => {});
    return done;
  }

  /**
   * Resolves with the transcript, or rejects (ModelMissingError if unset up).
   *
   * Takes ownership of `audio`: the samples are transferred to the worker, not
   * copied, so the array is detached and unusable once this is called. An hour
   * of audio is ~230 MB, which is worth not duplicating.
   */
  transcribe(
    audio: Float32Array,
    model: ModelId,
    onProgress: (p: Progress) => void,
    onPartial?: (text: string) => void,
  ): Promise<Transcript> {
    return this.track(() => this.sendTranscribe(audio, model, onProgress, onPartial));
  }

  /**
   * A short rolling window for the live captions. Dropped outright when the
   * worker is busy; the recording must never wait for a caption.
   */
  live(
    audio: Float32Array,
    model: ModelId,
    at: number,
    onResult: (text: string | null, at: number) => void,
  ): void {
    if (this.inFlight) return;
    void this.track(() => this.sendLive(audio, model, at, onResult));
  }

  private sendTranscribe(
    audio: Float32Array,
    model: ModelId,
    onProgress: (p: Progress) => void,
    onPartial: ((text: string) => void) | undefined,
  ): Promise<Transcript> {
    const id = String(++this.jobs);
    const worker = this.spawn();

    return new Promise((resolve, reject) => {
      const listener = (event: MessageEvent<FromWorker>) => {
        const msg = event.data;
        if (msg.type === 'loading') return onProgress({ stage: 'loading' });
        if (msg.id !== id) return;

        switch (msg.type) {
          case 'progress':
            return onProgress({ stage: 'working', done: msg.done, total: msg.total });
          case 'partial':
            return onPartial?.(msg.text);
          case 'done':
            worker.removeEventListener('message', listener);
            // A finished job gives the engine's memory back. The wasm heap
            // never frees itself while the worker lives: the model and its
            // arena stay resident, so the next transcription on a tired heap
            // dies mid-run allocating (seen: Best aborting with a bare number
            // after a run that only failed at the final save, which the page
            // treated as a failed job the worker had already survived). The
            // cost is one model load from disk per transcription, and the
            // reward is a clean heap every time. A live caption window keeps
            // its worker; only a finished transcription drops it.
            if (this.liveJobs === 0) {
              worker.terminate();
              this.worker = null;
            }
            return resolve({
              text: msg.text,
              segments: msg.segments,
              degenerate: msg.degenerate,
              noSpeech: msg.noSpeech,
              vadFailed: msg.vadFailed,
            });
          case 'failed':
            worker.removeEventListener('message', listener);
            // A failed load can leave the engine's wasm heap half-used (seen:
            // "failed to allocate a buffer" when a second session was created
            // after an earlier one never got freed). The only reliable way to
            // give the memory back is to drop the whole worker; the next job
            // spawns a fresh one.
            if (!msg.modelMissing) {
              this.worker?.terminate();
              this.worker = null;
            }
            return reject(
              msg.modelMissing ? new ModelMissingError(msg.message) : new Error(msg.message),
            );
        }
      };
      worker.addEventListener('message', listener);

      const job: ToWorker = {
        type: 'transcribe',
        id,
        audio,
        modelPath: abs('models/'),
        ortPath: abs('ort/'),
        model,
      };
      // Hand the samples over rather than copying them; a long talk is big.
      worker.postMessage(job, [audio.buffer]);
    });
  }

  private sendLive(
    audio: Float32Array,
    model: ModelId,
    at: number,
    onResult: (text: string | null, at: number) => void,
  ): Promise<void> {
    const id = 'live-' + String(++this.jobs);
    const worker = this.spawn();
    this.liveJobs++;
    return new Promise<void>((resolve) => {
      const listener = (event: MessageEvent<FromWorker>) => {
        const msg = event.data;
        // 'loading' carries no id, so it has to be shed before anything reads
        // one off the message.
        if (msg.type === 'loading') return;
        if (msg.id !== id) return;
        // A caption that failed is still a caption that finished. This promise
        // is what the queue chains on, so a live job that could only ever
        // resolve would hold the queue open for good if the worker died first,
        // and every later transcription would wait behind it silently.
        if (msg.type === 'failed') {
          worker.removeEventListener('message', listener);
          onResult(null, at);
          return resolve();
        }
        if (msg.type !== 'live') return;
        worker.removeEventListener('message', listener);
        onResult(msg.text, msg.at);
        resolve();
      };
      worker.addEventListener('message', listener);
      const job: ToWorker = {
        type: 'live',
        id,
        audio,
        modelPath: abs('models/'),
        ortPath: abs('ort/'),
        model,
        at,
      };
      worker.postMessage(job, [audio.buffer]);
    }).finally(() => {
      this.liveJobs--;
    });
  }

  private spawn(): Worker {
    this.worker ??= this.makeWorker();
    return this.worker;
  }
}
