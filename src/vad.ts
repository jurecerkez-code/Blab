// Silero VAD, run straight against the app's own onnxruntime copy.
//
// Why not transformers.js for this? The transformers-compatible silero
// export on HuggingFace is gated behind an agreement, and the public
// onnx-community export has no config.json, so transformers.js refuses it.
// The raw ONNX is small (640 KB) and speaks a fixed protocol; one 512-sample
// frame in, one speech probability out, plus two state tensors that carry
// over to the next frame; so driving it directly is less code than working
// around the wrapper, and it runs inside the same worker with the same
// vendored wasm.
//
// Timestamps matter here, which is also why this design keeps windows rather
// than vad-web-style clipped audio: every speech window keeps its place in
// the recording, so a transcript line still knows which second of audio it
// belongs to.
import * as ort from "onnxruntime-web";

/** Silero's fixed frame size: 32 ms at 16 kHz. */
const FRAME = 512;
const SAMPLE_RATE = 16000;
/** sigmoid(this or higher) counts as speech. */
const THRESHOLD = 0.5;
/** A run shorter than this many frames is a blip, not a word. */
const MIN_SPEECH_FRAMES = 8; // 0.25 s
/** A gap wider than this many frames splits two windows. */
const MIN_SILENCE_FRAMES = 6; // ~0.19 s
/** Kept around each window so a word cut at the edge survives. */
export const PAD_SAMPLES = 5600; // 0.35 s

/** A run of speech, in sample indices of the recording. */
export type SpeechWindow = { start: number; end: number };

/** A speech window's place in the recording, for mapping timestamps back. */
export type Offset = {
  /** Start of the window inside the assembled speech-only signal, in seconds. */
  concatSec: number;
  /** Start of the window in the recording, in seconds. */
  realSec: number;
  /** Window length (with padding), in seconds. */
  lenSec: number;
};

let session: ort.InferenceSession | null = null;
let sessionUrl = "";

async function vadSession(weights: string, ortPath: string): Promise<ort.InferenceSession> {
  if (session && sessionUrl === weights) return session;
  ort.env.wasm.wasmPaths = ortPath;
  ort.env.wasm.numThreads = 1; // inference is sequential; threads only add overhead
  session = await ort.InferenceSession.create(weights, { executionProviders: ["wasm"] });
  sessionUrl = weights;
  return session;
}

// ---------------------------------------------------------------- the loop

/**
 * Speech windows for one recording. Pure function of the samples.
 *
 * Silero is a stateful model: the state rows of a batch are independent
 * streams, so sequential audio has to go through frame at a time or hidden
 * state drifts. One call per 32 ms frame is a few thousand calls for a long
 * talk, and each call costs well under a millisecond on wasm, so the honest
 * loop is also the fast one.
 *
 * Throws on any model problem; callers fall back to no VAD rather than die.
 */
export async function speechWindows(
  audio: Float32Array,
  weights: string,
  ortPath: string,
): Promise<SpeechWindow[]> {
  const sess = await vadSession(weights, ortPath);
  const lower = sess.inputNames.map((n) => n.toLowerCase());

  const audioName = lower.find((n) => n !== "h" && n !== "c" && !n.includes("sr")) ?? lower[0];
  const hName = lower.find((n) => n === "h" || (n.includes("h") && !n.includes("c")));
  const cName = lower.find((n) => n === "c" || (n.includes("c") && !n.includes("h")));
  const srName = lower.find((n) => n.includes("sr"));
  if (!audioName || !hName || !cName) throw new Error("Unexpected silero ONNX inputs");
  const hidden = 64; // silero v4/v5 small; the state fallback below retries wider

  const outputs = sess.outputNames;
  const probName =
    outputs.find((n) => n.toLowerCase() === "output") ??
    outputs.find((n) => n.toLowerCase() !== hName && n.toLowerCase() !== cName) ??
    outputs[0];

  let h: Float32Array = new Float32Array(2 * hidden);
  let c: Float32Array = new Float32Array(2 * hidden);
  const frames = Math.ceil(audio.length / FRAME);
  const probs = new Float32Array(frames);

  const runOne = async (frame: number, hiddenSize: number): Promise<number> => {
    const x = new Float32Array(FRAME);
    const at = frame * FRAME;
    const take = Math.min(FRAME, audio.length - at);
    if (take > 0) x.set(audio.subarray(at, at + take));
    const feeds: Record<string, ort.Tensor> = {
      [audioName]: new ort.Tensor("float32", x, [1, FRAME]),
      [hName]: new ort.Tensor("float32", h, [2, 1, hiddenSize]),
      [cName]: new ort.Tensor("float32", c, [2, 1, hiddenSize]),
    };
    if (srName) feeds[srName] = new ort.Tensor("int64", new BigInt64Array([1n]), [1]);
    const out = await sess.run(feeds);
    h = out[hName].data as Float32Array;
    c = out[cName].data as Float32Array;
    return (out[probName].data as Float32Array)[0];
  };

  for (let f = 0; f < frames; f++) {
    try {
      probs[f] = await runOne(f, hidden);
    } catch (err) {
      // The first call can fail on a wrong guess at the hidden size. Retry the
      // whole pass with the next candidate, then give up.
      if (hidden === 64 && (err as Error).message.includes("shape")) {
        h = new Float32Array(2 * 128);
        c = new Float32Array(2 * 128);
        try {
          probs[f] = await runOne(f, 128);
        } catch {
          throw err;
        }
      } else {
        throw err;
      }
    }
  }

  // Frames to windows, with the standard hangover smoothing.
  const windows: SpeechWindow[] = [];
  let runStart = -1;
  let silence = 0;
  for (let f = 0; f < frames; f++) {
    const speech = probs[f] >= THRESHOLD;
    if (speech) {
      silence = 0;
      if (runStart < 0) runStart = f;
    } else if (runStart >= 0) {
      silence++;
      if (silence > MIN_SILENCE_FRAMES) {
        if (f - silence - runStart >= MIN_SPEECH_FRAMES) {
          windows.push({ start: runStart * FRAME, end: (f - silence) * FRAME });
        }
        runStart = -1;
        silence = 0;
      }
    }
  }
  if (runStart >= 0 && frames - runStart >= MIN_SPEECH_FRAMES) {
    windows.push({ start: runStart * FRAME, end: frames * FRAME });
  }
  return windows;
}

/**
 * Speech windows → the signal whisper will hear, and the map from its times
 * back to the recording's. Each window gets PAD_SAMPLES of quiet on either
 * side; the pad belongs to the window it wraps.
 */
export function assembleSpeech(
  audio: Float32Array,
  windows: SpeechWindow[],
): { samples: Float32Array; offsets: Offset[] } {
  const total = windows.reduce((n, w) => n + w.end - w.start + 2 * PAD_SAMPLES, 0);
  const samples = new Float32Array(total);
  const offsets: Offset[] = [];
  let at = 0;
  for (const w of windows) {
    const start = Math.max(0, w.start - PAD_SAMPLES);
    const end = Math.min(audio.length, w.end + PAD_SAMPLES);
    samples.set(audio.subarray(start, end), at);
    offsets.push({
      concatSec: at / SAMPLE_RATE,
      realSec: start / SAMPLE_RATE,
      lenSec: (end - start) / SAMPLE_RATE,
    });
    at += end - start;
  }
  return { samples, offsets };
}

/** Whisper time (seconds into the assembled signal) → recording time (ms). */
export function mapToRecording(seconds: number, offsets: Offset[]): number {
  for (const o of offsets) {
    if (seconds < o.concatSec + o.lenSec) {
      return Math.round((o.realSec + (seconds - o.concatSec)) * 1000);
    }
  }
  const last = offsets[offsets.length - 1];
  return Math.round((last.realSec + (seconds - last.concatSec)) * 1000);
}
