// Whisper runs here so a long talk never freezes the page.
import {
  BaseStreamer,
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
  type TextStreamer,
} from '@huggingface/transformers';
import { fromChunks } from './timeline';

/**
 * The English-only tier. Same two files and the same 73 MB as the multilingual
 * `whisper-base` it replaced, because the parameter count is identical — but a
 * model that spent all of it on one language is better at that language than
 * one that spread it across ninety-nine. Blab is English-only, so there is no
 * reason to carry the other ninety-eight.
 *
 * Swap for 'Xenova/whisper-tiny.en' if base is too slow on your laptop.
 */
const MODEL = 'Xenova/whisper-base.en';
const CHUNK_S = 30;
const STRIDE_S = 5;
/** Longest run of tokens allowed to repeat before generation is forced to move on. */
const NO_REPEAT_WORDS = 6;
const SAMPLE_RATE = 16000;

export type ToWorker = {
  type: 'transcribe';
  id: string;
  audio: Float32Array;
  modelPath: string;
  ortPath: string;
};

/** A stretch of speech and the millisecond of the recording it starts at. */
export type Segment = { at: number; text: string };

export type FromWorker =
  | { type: 'loading' }
  | { type: 'progress'; id: string; done: number; total: number }
  | { type: 'done'; id: string; text: string; segments: Segment[]; degenerate: boolean }
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
  // Every core the machine will admit to. The old cap of four was picked
  // before anything was measured and left half of an eight core laptop idle;
  // onnxruntime is the only heavy thing running, so there is nothing to save
  // the rest for. Without cross-origin isolation there are no threads to hand
  // out at all, hence the 1 — see the COOP/COEP headers in electron/main.cjs.
  wasm.numThreads = self.crossOriginIsolated ? navigator.hardwareConcurrency || 2 : 1;

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

/**
 * Above this, a transcript is repetition rather than speech.
 *
 * Real Whisper decides this the same way and re-runs the chunk at a higher
 * temperature when it trips. transformers.js implements none of that — there is
 * no compression_ratio_threshold, no logprob_threshold, no temperature fallback
 * anywhere in the bundle — so Blab cannot re-decode. What it can do is notice,
 * and say so, which is the difference between a file you throw away and a file
 * you do not know to throw away.
 *
 * Ordinary English gzips to about 1.5-2.0 here. The looped recording that
 * prompted this measured 3.15.
 */
const LOOP_RATIO = 2.4;

/** Gzip via the platform: no dependency, and the same metric Whisper uses. */
async function looping(text: string): Promise<boolean> {
  // Short transcripts compress badly for boring reasons — there is no room for
  // a dictionary to pay for itself — so the ratio means nothing down there.
  if (text.length < 200) return false;
  try {
    const raw = new TextEncoder().encode(text);
    const gz = new Response(
      new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip')),
    );
    const packed = (await gz.arrayBuffer()).byteLength;
    return raw.byteLength / packed > LOOP_RATIO;
  } catch {
    // A missing CompressionStream must never cost someone their transcript.
    return false;
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
      // Whisper knows when each phrase was said and will tell us for free — it
      // is the same generation either way. Having it means a transcript line
      // can point at a second of the audio, which is what makes clicking one
      // jump the player there.
      //
      // It does cost a little of the guard below. Timestamps are tokens too, so
      // a repetition that straddles a segment boundary has one wedged into the
      // middle of it and stops looking like a repeat. Loops inside a segment —
      // which is nearly all of them — are still cut at the second repetition.
      return_timestamps: true,
      // No `language` and no `task` here, and that is required rather than an
      // omission: an English-only model has no language or translate tokens at
      // all, and transformers.js rejects both options outright with "Cannot
      // specify `language` ... for an English-only model". English is not
      // selected, it is the only thing the weights can do.
      // Whisper gets stuck. On a quiet room, or noise that sounds vaguely like
      // speech, it will latch onto a phrase and repeat it hundreds of times —
      // one recording here lost 434 words in a row to "like a city". Forbidding
      // a repeated run of this many words breaks the loop at the second
      // repetition. Real speech does not repeat six words verbatim back to
      // back, so nothing genuine is lost.
      no_repeat_ngram_size: NO_REPEAT_WORDS,
      // The n-gram rule above only forbids an *exact* six word repeat, and a
      // real loop walks straight around it. One recording came back as
      // hundreds of "ti ki pi si" in every order: four tokens rearranged give
      // thousands of technically distinct six-grams, none of them a repeat.
      // This penalises a token for having been used at all, so a rotation
      // through a tiny vocabulary decays instead of running forever. Kept mild
      // — real speech reuses common words constantly and a heavy hand here
      // starts rewriting honest sentences.
      repetition_penalty: 1.15,
      // Typed as TextStreamer upstream, but generate() only ever calls
      // put()/end() — the BaseStreamer contract this implements.
      streamer: new ChunkCounter(id, total) as unknown as TextStreamer,
    });

    const parts = Array.isArray(result) ? result : [result];
    const text = parts
      .map((r) => r.text)
      .join(' ')
      .trim();
    post({ type: 'done', id, text, segments: fromChunks(parts), degenerate: await looping(text) });
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
