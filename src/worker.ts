// Whisper runs here so a long talk never freezes the page.
import {
  BaseStreamer,
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  type TextStreamer,
} from '@huggingface/transformers';

/** Swap for 'Xenova/whisper-tiny' if base is too slow on your laptop. */
const MODEL = 'Xenova/whisper-base';
const CHUNK_S = 30;
const STRIDE_S = 5;
const SAMPLE_RATE = 16000;

export type ToWorker = {
  type: 'transcribe';
  id: string;
  audio: Float32Array;
  modelPath: string;
  ortPath: string;
};

export type FromWorker =
  | { type: 'loading' }
  | { type: 'progress'; id: string; done: number; total: number }
  | { type: 'done'; id: string; text: string }
  | { type: 'failed'; id: string; message: string; modelMissing: boolean };

const post = (msg: FromWorker) => self.postMessage(msg);

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;

/** The weights file — the part that is missing when setup has not been run. */
const WEIGHTS = `${MODEL}/onnx/encoder_model_quantized.onnx`;

/** Marker so the main thread can offer the setup instructions, not a stack trace. */
class ModelMissing extends Error {}

/**
 * Checks the model is really on disk before we spend a minute finding out the
 * hard way. Worth doing because a dev server answers a missing file under
 * public/ with index.html and a 200, which reaches onnxruntime as a baffling
 * "protobuf parsing failed" instead of anything about a missing file.
 */
async function modelIsInstalled(modelPath: string): Promise<boolean> {
  try {
    const res = await fetch(new URL(WEIGHTS, modelPath), { method: 'HEAD' });
    if (!res.ok) return false;
    if ((res.headers.get('content-type') ?? '').includes('text/html')) return false;
    // The real file is ~22 MB; anything tiny is a stand-in page, not weights.
    return Number(res.headers.get('content-length')) > 1_000_000;
  } catch {
    return false;
  }
}

function load(modelPath: string, ortPath: string) {
  // Hard offline guarantee: if a file is missing we fail loudly rather than
  // quietly reaching for the internet.
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = modelPath;
  // The files are already on local disk, so the browser cache would only be a
  // second copy of 76 MB. Worse, if anything ever answers with a fallback page
  // instead of a model file, that page gets cached and the app stays broken
  // even after a correct setup. Read from disk every time instead.
  env.useBrowserCache = false;

  const wasm = env.backends.onnx.wasm!;
  wasm.wasmPaths = ortPath;
  wasm.proxy = false; // already off the main thread
  wasm.numThreads = self.crossOriginIsolated
    ? Math.min(4, navigator.hardwareConcurrency || 2)
    : 1;

  return pipeline('automatic-speech-recognition', MODEL, { device: 'wasm', dtype: 'q8' });
}

/** How many 30s windows the pipeline will walk through, so we can show progress. */
function countChunks(samples: number): number {
  const window = CHUNK_S * SAMPLE_RATE;
  const jump = (CHUNK_S - 2 * STRIDE_S) * SAMPLE_RATE;
  if (samples <= window) return 1;
  return Math.ceil((samples - window) / jump) + 1;
}

/** The pipeline ends one generation per chunk; that is our progress tick. */
class ChunkCounter extends BaseStreamer {
  private done = 0;
  constructor(
    private id: string,
    private total: number,
  ) {
    super();
  }
  put() {}
  end() {
    this.done = Math.min(this.done + 1, this.total);
    post({ type: 'progress', id: this.id, done: this.done, total: this.total });
  }
}

self.addEventListener('message', async (event: MessageEvent<ToWorker>) => {
  if (event.data.type !== 'transcribe') return;
  const { id, audio, modelPath, ortPath } = event.data;
  let ready = false;

  try {
    if (!asr) {
      post({ type: 'loading' });
      if (!(await modelIsInstalled(modelPath))) {
        throw new ModelMissing(`No Whisper weights at ${modelPath}${WEIGHTS}`);
      }
      asr = load(modelPath, ortPath);
    }
    const transcribe = await asr;
    ready = true;

    const total = countChunks(audio.length);
    post({ type: 'progress', id, done: 0, total });

    const result = await transcribe(audio, {
      chunk_length_s: CHUNK_S,
      stride_length_s: STRIDE_S,
      return_timestamps: false,
      // Typed as TextStreamer upstream, but generate() only ever calls
      // put()/end() — the BaseStreamer contract this implements.
      streamer: new ChunkCounter(id, total) as unknown as TextStreamer,
    });

    const text = (Array.isArray(result) ? result.map((r) => r.text).join(' ') : result.text).trim();
    post({ type: 'done', id, text });
  } catch (err) {
    // A failed load must not be cached, or every later attempt fails too. A
    // model that loaded fine and then hit a bad clip is worth keeping — it
    // takes seconds to load and the next recording will want it.
    if (!ready) asr = null;
    const message = err instanceof Error ? err.message : String(err);
    post({
      type: 'failed',
      id,
      message,
      // The regex catches a half-finished setup, where the weights are there
      // but some smaller file never landed.
      modelMissing:
        err instanceof ModelMissing || /not found locally|allowRemoteModels=false/.test(message),
    });
  }
});
