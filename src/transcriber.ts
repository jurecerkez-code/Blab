import type { FromWorker, ToWorker } from './worker';

export type Progress =
  | { stage: 'loading' }
  | { stage: 'working'; done: number; total: number };

export class ModelMissingError extends Error {}

/** Absolute, because paths inside a worker resolve against the worker file. */
const abs = (path: string) => new URL(path, document.baseURI).href;

/**
 * Owns the transcription worker. One job at a time — a laptop running Whisper
 * has nothing spare anyway.
 */
export class Transcriber {
  private worker: Worker | null = null;
  private jobs = 0;
  /** Jobs run one after another; the model holds state we must not share. */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Resolves with the transcript, or rejects (ModelMissingError if unset up).
   *
   * Takes ownership of `audio`: the samples are transferred to the worker, not
   * copied, so the array is detached and unusable once this is called. An hour
   * of audio is ~230 MB, which is worth not duplicating.
   */
  transcribe(audio: Float32Array, onProgress: (p: Progress) => void): Promise<string> {
    const run = this.queue.then(() => this.send(audio, onProgress));
    this.queue = run.catch(() => {});
    return run;
  }

  private send(audio: Float32Array, onProgress: (p: Progress) => void): Promise<string> {
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
          case 'done':
            worker.removeEventListener('message', listener);
            return resolve(msg.text);
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
      };
      // Hand the samples over rather than copying them; a long talk is big.
      worker.postMessage(job, [audio.buffer]);
    });
  }

  private spawn(): Worker {
    this.worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    return this.worker;
  }
}
