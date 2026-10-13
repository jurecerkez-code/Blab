// Whisper runs here so a long talk never freezes the page.
import {
  Tensor,
  TextStreamer,
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
} from '@huggingface/transformers';
import { type ModelId, modelById } from './models';
import { type Line, fromChunks } from './timeline';
import { assembleSpeech, mapToRecording, nearestJoin, speechWindows, type Offset } from './vad';
import { filterTimestampTokens } from './tokens';
import { engineOutOfMemory, engineWords } from './engine-errors';
import { looping } from './loops';
import { type Guess, fromLogits, stretches } from './language';

/**
 * Whisper stays multilingual, and that is what lets Blab write each stretch
 * of a recording in the language it was spoken in.
 *
 * `whisper-base.en` is the obvious swap; same parameter count, same 73 MB,
 * all of it spent on one language, and it was tried. On five sentences put
 * through both, it tied on three, both got one wrong, and it lost the fifth:
 * "rear delt" came back as "rear dealt" where the multilingual model wrote it
 * correctly. Aggregate benchmarks favour the .en tiers; this vocabulary did
 * not, so the measurement wins over the benchmark. An English-only model also
 * has no language tokens, so it could not say what it hears.
 */
const CHUNK_S = 30;
const STRIDE_S = 5;
/** Longest run of tokens allowed to repeat before generation is forced to move on. */
const NO_REPEAT_WORDS = 6;
const SAMPLE_RATE = 16000;

export type ToWorker =
  | {
      type: 'transcribe';
      id: string;
      audio: Float32Array;
      modelPath: string;
      ortPath: string;
      /** Which of the installed models to run. */
      model: ModelId;
    }
  | {
      type: 'live';
      id: string;
      audio: Float32Array;
      modelPath: string;
      ortPath: string;
      model: ModelId;
      /** Where this window starts in the recording, in ms. */
      at: number;
    };

/** A stretch of speech and the millisecond of the recording it starts at. */
export type Segment = { at: number; text: string };

export type FromWorker =
  | { type: 'loading' }
  | { type: 'progress'; id: string; done: number; total: number }
  /** Fired as each chunk finishes, with the plain words so far (no times). */
  | { type: 'partial'; id: string; text: string }
  | {
      type: 'done';
      id: string;
      text: string;
      segments: Segment[];
      degenerate: boolean;
      noSpeech: boolean;
      /** The detector was installed but could not run; nothing was skipped. */
      vadFailed: boolean;
    }
  | { type: 'live'; id: string; text: string | null; at: number }
  | { type: 'failed'; id: string; message: string; modelMissing: boolean; oom?: boolean }

const post = (msg: FromWorker) => self.postMessage(msg);

/** One pipeline per model, kept for the life of the worker. */
const asrCache = new Map<string, Promise<AutomaticSpeechRecognitionPipeline>>();

/** The weights file; the part that is missing when setup has not been run. */
const weightsFor = (repo: string, modelPath: string) => {
  const base = modelPath.endsWith('/') ? modelPath : modelPath + '/';
  return `${base}${repo}/onnx/encoder_model_quantized.onnx`;
};
const vadWeights = (modelPath: string) =>
  `${modelPath}onnx-community/silero-vad/onnx/model_quantized.onnx`;

/** Marker so the main thread can offer the setup instructions, not a stack trace. */
class ModelMissing extends Error {}

/**
 * Checks the model is really on disk before we spend a minute finding out the
 * hard way. Worth doing because a dev server answers a missing file under
 * public/ with index.html and a 200, which reaches onnxruntime as a baffling
 * "protobuf parsing failed" instead of anything about a missing file.
 */
async function modelIsInstalled(url: string, minBytes = 1_000_000): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) return false;
    if ((res.headers.get('content-type') ?? '').includes('text/html')) return false;
    // Whisper weights are many MB; anything tiny is a stand-in page, not a
    // model. The floor is a parameter because it is not the same number for
    // every model here: the silero detector is 0.6 MB, and a flat 1 MB test
    // marked it missing on every machine, which is why voice-activity
    // detection has never once run in a shipped build.
    return Number(res.headers.get('content-length')) > minBytes;
  } catch {
    return false;
  }
}

async function load(repo: string, modelPath: string, ortPath: string) {
  // Hard offline guarantee: if a file is missing we fail loudly rather than
  // quietly reaching for the internet.
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = modelPath;
  // The files are already on local disk, so the browser cache would only be a
  // second copy of many megabytes. Worse, if anything ever answers with a
  // fallback page instead of a model file, that page gets cached and the app
  // stays broken even after a correct setup. Read from disk every time.
  env.useBrowserCache = false;

  const wasm = env.backends.onnx.wasm!;
  wasm.wasmPaths = ortPath;
  wasm.proxy = false; // already off the main thread
  // Every core the machine will admit to. The old cap of four was picked
  // before anything was measured and left half of an eight core laptop idle;
  // onnxruntime is the only heavy thing running, so there is nothing to save
  // the rest for. Without cross-origin isolation there are no threads to hand
  // out at all, hence the 1; see the COOP/COEP headers in electron/main.cjs.
  wasm.numThreads = self.crossOriginIsolated ? navigator.hardwareConcurrency || 2 : 1;

  return pipeline('automatic-speech-recognition', repo, { device: 'wasm', dtype: 'q8' });
}

function getAsr(repo: string, modelPath: string, ortPath: string) {
  let p = asrCache.get(repo);
  if (!p) {
    p = load(repo, modelPath, ortPath);
    asrCache.set(repo, p);
  }
  return p;
}

/** How many 30s windows the pipeline will walk through, so we can show progress. */
function countChunks(samples: number): number {
  const window = CHUNK_S * SAMPLE_RATE;
  const jump = (CHUNK_S - 2 * STRIDE_S) * SAMPLE_RATE;
  if (samples <= window) return 1;
  return Math.ceil((samples - window) / jump) + 1;
}

/**
 * Text so far, pushed to the page after each chunk, and the chunk counter
 * that already drove progress. Both in one streamer: generate() calls
 * end() once per chunk, which is the same moment a partial is worth saving.
 */
class PartialStreamer extends TextStreamer {
  private acc = '';
  constructor(
    tokenizer: any,
    private readonly id: string,
    private done: number,
    private readonly total: number,
    private readonly onPartial: (id: string, text: string) => void,
  ) {
    super(tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (t: string) => (this.acc += t),
    });
  }
  /**
   * Whisper's timestamp tokens (`<|1.32|>`) are not marked as special in the
   * tokenizer config, so skip_special_tokens leaves them in and they crawl
   * into the partial text, and their presence even makes the incremental
   * decoder repeat words. Filter the token ids by their decoded form before
   * the streamer turns them into text.
   */
  override put(value: bigint[][]): void {
    super.put([filterTimestampTokens(value[0])]);
  }
  override end(): void {
    // super first, and it is not optional. TextStreamer.end() is what flushes
    // the tail of the chunk through callback_function and clears token_cache
    // and print_len. Without it the last few tokens of every chunk never
    // reached `acc`, the cache grew for the whole recording so each chunk
    // re-decoded everything before it, and skip_prompt stopped applying from
    // the second chunk on.
    super.end();
    this.done = Math.min(this.done + 1, this.total);
    post({ type: 'progress', id: this.id, done: this.done, total: this.total });
    this.onPartial(this.id, this.acc);
  }
}

/** Whisper timestamp tokens that leak into decoded text on some paths. */
const TIME_TOKEN = /<\|[\d.]+\|>/g;

/** Words only. A timestamp token that survived decoding is not a word. */
function stripTimestamps(text: string): string {
  return text.replace(TIME_TOKEN, ' ').replace(/\s+/g, ' ').trim();
}

/** The common transcription settings, shared by the full and live jobs. */
function settings(streamer: TextStreamer, language: string) {
  return {
    chunk_length_s: CHUNK_S,
    stride_length_s: STRIDE_S,
    // Whisper knows when each phrase was said and will tell us for free; it
    // is the same generation either way. Having it means a transcript line
    // can point at a second of the audio, which is what makes clicking one
    // jump the player there.
    return_timestamps: true,
    task: 'transcribe' as const,
    // Always named, never left out: transformers.js has no detection and,
    // left to itself, quietly assumes English. Named wrong, Whisper does as
    // it is told: English named on Croatian comes back as an English that
    // invents, and Croatian named on English as a loop. The language picker
    // that used to set this by hand is gone for that reason; the full job
    // now asks Whisper itself, per stretch (see planLanguages), and live
    // captions, a preview, stay English.
    language,
    // Whisper gets stuck. On a quiet room, or noise that sounds vaguely like
    // speech, it will latch onto a phrase and repeat it hundreds of times,
    // one recording here lost 434 words in a row to "like a city". Forbidding
    // a repeated run of this many words breaks the loop at the second
    // repetition. Real speech does not repeat six words verbatim back to
    // back, so nothing genuine is lost.
    no_repeat_ngram_size: NO_REPEAT_WORDS,
    // The n-gram rule above only forbids an *exact* six word repeat, and a
    // real loop walks straight around it. One recording came back as
    // hundreds of "ti ki pi si" in every order: four tokens rearranged give
    // thousands of technically distinct six-grams, none of them a repeat.
    // REMOVED: repetition_penalty. It taxed every reused token, and Whisper
    // reuses its timestamp tokens between every phrase, so on dense audio the
    // penalty piled up until ending the chunk beat continuing it: recordings
    // came back cut short, always a little past the halfway mark of a chunk.
    // Measured on a real recording: with the penalty the text stops at 37 s,
    // without it the same audio decodes complete. Loop defence stays with the
    // n-gram ban above and the degenerate loop detector, which catches the
    // token-rotation loops a repeat ban cannot.
    // A hard ceiling on how long one 30 s chunk may run. Whisper cannot go
    // past 448 for a 30 s window anyway, so this is also the runaway cap.
    // It sat at 224, "generous for what a person can say in 30 seconds",
    // until silence skipping and level normalisation made the chunks dense:
    // thirty seconds of non stop speech plus its timestamp tokens runs to
    // 300 or more, and the cap cut every dense chunk short, dropping the
    // tail of recording after recording.
    max_new_tokens: 448,
    // Explicit greedy, matching whisper.cpp's temperature 0 default. Do not
    // read this as "we tried sampling and chose not to": transformers.js has no
    // temperature fallback loop, and no beam search either (its seq2seq path
    // carries a literal "TODO: Support beam search"). Both were measured on a
    // real sample (see the 0.7.1 changelog) and neither is available here, so
    // the guards above and the VAD pass carry that load instead.
    temperature: 0,
    streamer,
  };
}

/** A stretch of the speech signal, in samples, and the language spoken in it. */
type Piece = { start: number; end: number; language: string };

/** How far a cut between two languages may move to land in a pause, in seconds. */
const CUT_REACH_S = 10;

/**
 * What Whisper thinks it hears in one window: the encoder once, then the
 * decoder's first step after <|startoftranscript|>, read over the language
 * tokens alone. That is the whole of Whisper's own detect_language, which
 * transformers.js 3.7.6 leaves as a TODO.
 */
async function guessLanguage(
  asr: AutomaticSpeechRecognitionPipeline,
  samples: Float32Array,
): Promise<Guess> {
  const config = asr.model.generation_config as any;
  const { input_features } = await (asr.processor as any)(samples);
  const start = new Tensor('int64', BigInt64Array.from([BigInt(config.decoder_start_token_id)]), [1, 1]);
  const { logits } = await (asr.model as any)({ input_features, decoder_input_ids: start });
  const scores = logits.data as Float32Array;
  return fromLogits(
    Object.entries(config.lang_to_id as Record<string, number>).map(
      ([token, tokenId]) => [token.slice(2, -2), scores[tokenId]] as [string, number],
    ),
  );
}

/**
 * The speech signal cut into stretches, each in the language it was spoken
 * in: one guess per CHUNK_S of speech, src/language.ts to turn the guesses
 * into stretches, and every cut moved into the nearest pause so no word is
 * split between two languages.
 *
 * A recording in one language is one piece, and transcribes exactly as it did
 * before Blab asked. Anything going wrong here leaves the whole signal in
 * English, which is what Blab always did; asking must never cost a transcript.
 */
async function planLanguages(
  asr: AutomaticSpeechRecognitionPipeline,
  source: Float32Array,
  offsets: Offset[],
  onWindow: (done: number) => void,
): Promise<Piece[]> {
  const whole: Piece[] = [{ start: 0, end: source.length, language: 'en' }];
  const config = asr.model.generation_config as any;
  if (!config?.is_multilingual || !config.lang_to_id) return whole;
  const window = CHUNK_S * SAMPLE_RATE;
  const count = Math.ceil(source.length / window);
  try {
    const guesses: Guess[] = [];
    for (let i = 0; i < count; i++) {
      // The last window is read flush with the end, so it is full of speech
      // rather than mostly padding: a few seconds padded out to 30 is where
      // the guess turned to noise.
      const at = Math.min(i * window, Math.max(0, source.length - window));
      guesses.push(await guessLanguage(asr, source.subarray(at, at + window)));
      onWindow(i + 1);
    }
    const cut = (w: number) =>
      w >= count
        ? source.length
        : Math.min(source.length, Math.round(nearestJoin(w * CHUNK_S, offsets, CUT_REACH_S) * SAMPLE_RATE));
    // Under one window of speech, Whisper still hears 30 seconds: the rest is
    // silence it was padded with, and the guess is shakier for it.
    return stretches(guesses, source.length < window)
      .map((s) => ({ start: s.from === 0 ? 0 : cut(s.from), end: cut(s.to), language: s.language }))
      .filter((p) => p.end > p.start);
  } catch (err) {
    // Except running out of memory: carrying on in English then would write
    // the invented English this exists to stop, on an engine already short of
    // room. Failing as out of memory lets the page retry Best on Balanced,
    // which has the room to ask.
    if (engineOutOfMemory(err instanceof Error ? err.message : String(err))) throw err;
    return whole;
  }
}

async function runTranscribe(
  id: string,
  audio: Float32Array,
  modelPath: string,
  ortPath: string,
  model: ModelId,
): Promise<void> {
  const repo = modelById(model).repo;
  try {
    post({ type: 'loading' });
    const weights = weightsFor(repo, modelPath);
    if (!(await modelIsInstalled(weights))) {
      throw new ModelMissing(`No Whisper weights at ${modelPath}${repo}/onnx/encoder_model_quantized.onnx`);
    }
    const asr = await getAsr(repo, modelPath, ortPath);

    // VAD first: silence is where Whisper hallucinates, and skipping it is
    // how a quiet room stops costing minutes. Fall back to the full signal
    // the moment anything about the VAD is uncertain.
    let source = audio;
    let offsets: ReturnType<typeof assembleSpeech>['offsets'] = [];
    let vadFailed = false;
    // 100 KB, not the Whisper default: the silero detector is 0.6 MB and the
    // 1 MB floor rejected it every time, so this branch has never run. A
    // stand-in HTML page is a few KB and is still refused.
    if (await modelIsInstalled(vadWeights(modelPath), 100_000)) {
      try {
        const windows = await speechWindows(audio, vadWeights(modelPath), ortPath);
        if (windows.length) {
          const built = assembleSpeech(audio, windows);
          source = built.samples;
          offsets = built.offsets;
        } else {
          source = new Float32Array(0); // a recording with nothing to say
        }
      } catch {
        vadFailed = true;
        source = audio;
      }
    }

    let text = '';
    let segments: Segment[] = [];
    let noSpeech = false;

    if (source.length > 0) {
      // Progress counts the language guesses (one per window) and then the
      // chunks Whisper transcribes; the second half is only known once the
      // stretches are, so the total is an estimate until then.
      const windows = Math.ceil(source.length / (CHUNK_S * SAMPLE_RATE));
      const guessing = windows + countChunks(source.length);
      post({ type: 'progress', id, done: 0, total: guessing });
      const pieces = await planLanguages(asr, source, offsets, (done) =>
        post({ type: 'progress', id, done, total: guessing }),
      );
      const total = windows + pieces.reduce((n, p) => n + countChunks(p.end - p.start), 0);

      // One streamer for every piece, so the partial text runs on in order.
      const streamer = new PartialStreamer(asr.tokenizer as any, id, windows, total, (_id, partialText) => {
        post({ type: 'partial', id, text: partialText });
      });
      const parts: { text: string }[] = [];
      const rawLines: Line[] = [];
      for (const piece of pieces) {
        const result = await asr(source.subarray(piece.start, piece.end), settings(streamer, piece.language));
        const got = Array.isArray(result) ? result : [result];
        parts.push(...got);
        // Whisper times a piece from its own start; the lines want the signal's.
        const shift = Math.round((piece.start / SAMPLE_RATE) * 1000);
        rawLines.push(...fromChunks(got).map((l) => ({ ...l, at: l.at + shift })));
      }

      text = stripTimestamps(
        parts
          .map((r) => r.text)
          .join(' ')
          .trim(),
      );
      segments =
        offsets.length > 0
          ? rawLines.map((l) => ({
              at: mapToRecording(l.at / 1000, offsets),
              text: stripTimestamps(l.text),
            }))
          : rawLines.map((l) => ({ ...l, text: stripTimestamps(l.text) }));
    } else {
      noSpeech = true;
    }

    post({
      type: 'done',
      id,
      text,
      segments,
      degenerate: vadFailed ? false : await looping(text),
      noSpeech,
      vadFailed,
    });
  } catch (err) {
    // A failed load must not be cached, or every later attempt fails too. A
    // model that loaded fine and then hit a bad clip is worth keeping; it
    // takes seconds to load and the next recording will want it.
    asrCache.delete(repo);
    // A bare number is what a wasm memory abort looks like from here (seen:
    // 1283623640, the medium encoder as one float array). engineWords turns
    // that and its text-shaped cousins into words with a next step, and the
    // oom flag tells the page the truth no matter what the words say.
    const raw = err instanceof Error ? err.message : String(err);
    post({
      type: 'failed',
      id,
      message: engineWords(raw),
      modelMissing: err instanceof ModelMissing || /not found locally|allowRemoteModels=false/.test(raw),
      oom: engineOutOfMemory(raw),
    });
  }
}

/** A short window for the live captions; partial results are fine. */
async function runLive(
  id: string,
  audio: Float32Array,
  modelPath: string,
  ortPath: string,
  model: ModelId,
  at: number,
): Promise<void> {
  try {
    const repo = modelById(model).repo;
    const asr = await getAsr(repo, modelPath, ortPath);
    const result = await asr(audio, settings(new TextStreamer(asr.tokenizer as any, { skip_prompt: true }), 'en'));
    const parts = Array.isArray(result) ? result : [result];
    const text = stripTimestamps(
      parts
        .map((r) => r.text)
        .join(' ')
        .trim(),
    );
    const first = fromChunks(parts)[0];
    post({ type: 'live', id, text: text || null, at: first ? at + first.at : at });
  } catch {
    // Live captions are a preview; the real transcript happens at Stop with
    // the full pipeline. A failure here must never cost the recording.
    post({ type: 'live', id, text: null, at });
  }
}

self.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  if (event.data.type === 'transcribe') {
    void runTranscribe(event.data.id, event.data.audio, event.data.modelPath, event.data.ortPath, event.data.model);
  } else if (event.data.type === 'live') {
    void runLive(event.data.id, event.data.audio, event.data.modelPath, event.data.ortPath, event.data.model, event.data.at);
  }
});
