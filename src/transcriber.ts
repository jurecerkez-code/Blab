import type { ModelId } from './models';
import type { FromWorker, Segment, ToWorker } from './worker';

export type { Segment };

/**
 * The words, and where each phrase sits in the audio. `segments` is empty only
 * if Whisper returned no timestamps at all; `text` is always the whole thing.
 */
export type Transcript = { text: string; segments: Segment[]; degenerate: boolean; noSpeech: boolean };

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
  /** A full or live job is running right now. Live jobs skip when this is set. */
  private inFlight = false;
  /** Jobs run one after another; the model holds state we must not share. */
  private queue: Promise<unknown> = Promise.resolve();

  private track<T>(p: Promise<T>): Promise<T> {
    this.inFlight = true;
    const done = this.queue.then(() => p).finally(() => {
      this.inFlight = false;
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
    return this.track(this.sendTranscribe(audio, model, onProgress, onPartial));
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
    void this.track(this.sendLive(audio, model, at, onResult));
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
            return resolve({
              text: msg.text,
              segments: msg.segments,
              degenerate: msg.degenerate,
              noSpeech: msg.noSpeech,
            });
          case 'failed':
            worker.removeEventListener('message', listener);
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
    return new Promise((resolve) => {
      const listener = (event: MessageEvent<FromWorker>) => {
        const msg = event.data;
        if (msg.type !== 'live' || msg.id !== id) return;
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
    });
  }

  private spawn(): Worker {
    this.worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    return this.worker;
  }
}
