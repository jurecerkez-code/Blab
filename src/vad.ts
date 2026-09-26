// Silero VAD, run straight against the app's own onnxruntime copy.
//
// Why not transformers.js for this? The transformers-compatible silero
// export on HuggingFace is gated behind an agreement, and the public
// onnx-community export has no config.json, so transformers.js refuses it.
// The raw ONNX is small (640 KB) and speaks a fixed protocol; one 512-sample
// frame in, one speech probability out, plus the state tensors that carry
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
/** sigmoid(this or higher) starts a speech run. */
const THRESHOLD = 0.5;
/**
 * A run already going survives a dip to this. A quiet mic flickers 0.3 to 0.9
 * mid-word (measured on a real recording: whole sentences at 0.1 to 0.3 that
 * are plainly speech); ending the run on every dip below 0.5 shredded them.
 * Below this low line the run really is over.
 */
const HOLD_THRESHOLD = 0.35;
/** A run shorter than this many frames is a blip, not a word. */
const MIN_SPEECH_FRAMES = 8; // 0.25 s
/**
 * A gap wider than this many frames splits two windows. Half a second: a
 * breathing pause stays inside one window, which is what Whisper wants, and
 * a sentence break still splits.
 */
const MIN_SILENCE_FRAMES = 32; // 0.5 s
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
 * Which tensors to feed and which to read back, worked out from the model's
 * own names.
 *
 * Silero ships in two shapes and the export decides which. v4 is fed h and c
 * and returns hn and cn: two state tensors, [2,1,64] each. v5 carries one
 * combined state, [2,1,128], in and out. The model installed here is v5:
 *
 *   INPUTS  input, state, sr        OUTPUTS  output, stateN
 *
 * None of which was detected. The old code hunted for inputs literally named
 * h and c, found neither, and threw "Unexpected silero ONNX inputs" before a
 * single frame ever ran — which, with the size gate in the worker, is why
 * voice-activity detection never worked in a shipped build. Reading the names
 * and counting the state tensors covers both without this code needing to
 * know which version it was handed.
 *
 * Pure, and exported, so tests/vad.spec.ts can hold it to both shapes without
 * a model on disk.
 */
export function sileroPlan(
  inputs: readonly string[],
  outputs: readonly string[],
): {
  audioName: string;
  srName: string | undefined;
  stateIns: string[];
  stateOuts: string[];
  hidden: number;
} {
  const isRate = (n: string) => n.toLowerCase().includes("sr");
  const audioName =
    inputs.find((n) => n.toLowerCase() === "input") ?? inputs.find((n) => !isRate(n)) ?? inputs[0];
  const srName = inputs.find(isRate);
  const stateIns = inputs.filter((n) => n !== audioName && n !== srName);

  const probName = outputs.find((n) => n.toLowerCase() === "output") ?? outputs[0];
  // The state comes back under the OUTPUT names, which are never the input
  // names. Reading out[hName] was the output map indexed with an input name.
  const stateOuts = outputs.filter((n) => n !== probName);

  if (!audioName || !stateIns.length || stateIns.length !== stateOuts.length) {
    throw new Error(
      `Unexpected silero ONNX: inputs ${inputs.join(", ")}; outputs ${outputs.join(", ")}`,
    );
  }
  // One combined state is v5 and 128 wide; a separate h and c is v4 at 64.
  return { audioName, srName, stateIns, stateOuts, hidden: stateIns.length === 1 ? 128 : 64 };
}

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
  const outputs = sess.outputNames;
  const { audioName, srName, stateIns, stateOuts, hidden: hidden0 } = sileroPlan(
    sess.inputNames,
    outputs,
  );
  const probName = outputs.find((n) => n.toLowerCase() === "output") ?? outputs[0];
  let hidden = hidden0;
  let state: Float32Array[] = stateIns.map(() => new Float32Array(2 * hidden));

  const frames = Math.ceil(audio.length / FRAME);
  const probs = new Float32Array(frames);

  const runOne = async (frame: number, hiddenSize: number): Promise<number> => {
    const x = new Float32Array(FRAME);
    const at = frame * FRAME;
    const take = Math.min(FRAME, audio.length - at);
    if (take > 0) x.set(audio.subarray(at, at + take));
    const feeds: Record<string, ort.Tensor> = {
      [audioName]: new ort.Tensor("float32", x, [1, FRAME]),
    };
    stateIns.forEach((name, i) => {
      feeds[name] = new ort.Tensor("float32", state[i], [2, 1, hiddenSize]);
    });
    // The sample rate, not 1. Silero takes 16000 or 8000 here, and everything
    // reaching this point has already been resampled to the 16 kHz Whisper
    // wants. A 1 is not a rate silero knows.
    if (srName) {
      feeds[srName] = new ort.Tensor("int64", new BigInt64Array([BigInt(SAMPLE_RATE)]), [1]);
    }
    const out = await sess.run(feeds);
    state = stateOuts.map((name) => out[name].data as Float32Array);
    return (out[probName].data as Float32Array)[0];
  };

  for (let f = 0; f < frames; f++) {
    try {
      probs[f] = await runOne(f, hidden);
    } catch (err) {
      // The width is inferred from how many state tensors there are, so if it
      // was wrong the other candidate is the only one left. A mismatch shows
      // up on the first frame or not at all. The old retry passed 128 to one
      // call while the variable stayed 64, so it never survived into frame 2.
      if (f !== 0) throw err;
      const other = hidden === 64 ? 128 : 64;
      state = stateIns.map(() => new Float32Array(2 * other));
      probs[f] = await runOne(f, other);
      hidden = other;
    }
  }

  return windowsFromProbs(probs);
}

/**
 * Frames to windows, with the standard hangover smoothing and a hysteresis:
 * a run starts at THRESHOLD and holds to HOLD_THRESHOLD, so the flicker of a
 * quiet mic does not shred one sentence into fragments the builder then drops
 * for being too short. Pure and exported for tests.
 */
export function windowsFromProbs(probs: Float32Array): SpeechWindow[] {
  const windows: SpeechWindow[] = [];
  let runStart = -1;
  let lastSpeech = -1;
  let silence = 0;
  for (let f = 0; f < probs.length; f++) {
    const p = probs[f];
    const speech = runStart >= 0 ? p >= HOLD_THRESHOLD : p >= THRESHOLD;
    if (speech) {
      silence = 0;
      lastSpeech = f;
      if (runStart < 0) runStart = f;
    } else if (runStart >= 0) {
      silence++;
      if (silence > MIN_SILENCE_FRAMES) {
        if (lastSpeech - runStart + 1 >= MIN_SPEECH_FRAMES) {
          windows.push({ start: runStart * FRAME, end: (lastSpeech + 1) * FRAME });
        }
        runStart = -1;
        silence = 0;
      }
    }
  }
  if (runStart >= 0 && lastSpeech - runStart + 1 >= MIN_SPEECH_FRAMES) {
    windows.push({ start: runStart * FRAME, end: (lastSpeech + 1) * FRAME });
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
  // Two windows closer than two pads would copy the same stretch of recording
  // twice, and Whisper then hears a stutter that was never said. Cut each
  // copy's head at the previous copy's tail; a window already fully covered
  // by the one before it is skipped outright.
  const copies: { start: number; end: number }[] = [];
  let prevEnd = 0;
  for (const w of windows) {
    const start = Math.max(0, w.start - PAD_SAMPLES, prevEnd);
    const end = Math.min(audio.length, w.end + PAD_SAMPLES);
    if (end <= start) continue;
    copies.push({ start, end });
    prevEnd = end;
  }

  const total = copies.reduce((n, c) => n + c.end - c.start, 0);
  const samples = new Float32Array(total);
  const offsets: Offset[] = [];
  let at = 0;
  for (const c of copies) {
    samples.set(audio.subarray(c.start, c.end), at);
    offsets.push({
      concatSec: at / SAMPLE_RATE,
      realSec: c.start / SAMPLE_RATE,
      lenSec: (c.end - c.start) / SAMPLE_RATE,
    });
    at += c.end - c.start;
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
