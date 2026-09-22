// The one network moment. Run once: `npm run setup`.
// Pulls the Whisper models into public/models and the onnxruntime wasm binaries
// into public/ort. After this, Blab never touches the network again.
//
//   npm run setup            the default "fast" model (whisper-base)
//   npm run setup small      add the better "balanced" model
//   npm run setup medium     add the best, slowest model
//   npm run setup all        every model
//   npm run setup clean      back to the default model alone
//
// Models accumulate: switching models in the app is a runtime choice, so the
// setup keeps everything it has ever fetched until told to clean.
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'https://huggingface.co';

// The models the app can run, by the name the picker uses. Only whisper-base
// is on the Blab mirror; the others come from HuggingFace (still one fetch,
// still cached forever after).
const MODELS = {
  base: 'Xenova/whisper-base',
  small: 'Xenova/whisper-small',
  medium: 'Xenova/whisper-medium',
};
/** What a bare `npm run setup` fetches, as the header above promises. */
const DEFAULT_MODEL = 'base';
const MIRROR_MODEL = MODELS.base;
const MIRROR = 'https://github.com/jurecerkez-code/Blab/releases/download/model-mirror';

// The small voice-activity detector that lets transcription skip silence.
const VAD = { org: 'onnx-community', model: 'silero-vad', file: 'onnx/model_quantized.onnx' };

// Same set for every whisper model: transformers.js loads exactly these.
const MODEL_FILES = [
  'config.json',
  'generation_config.json',
  'preprocessor_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/encoder_model_quantized.onnx',
  'onnx/decoder_model_merged_quantized.onnx',
];

// onnxruntime picks one of these at runtime depending on the browser. Both are
// copied so the choice never becomes a network request.
const ORT_FILES = [
  'ort-wasm-simd-threaded.wasm',
  'ort-wasm-simd-threaded.mjs',
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.jsep.mjs',
];

const want = process.argv.slice(2).join(' ').toLowerCase();
const names = Object.keys(MODELS);
let toFetch;
if (want === 'all') toFetch = names;
else if (want === 'clean') toFetch = [];
// No argument is the documented default, and it has to be checked before the
// search below: `''.includes('base')` is false, so an empty argv fell through
// to the throw. That took out every release build from 0.7.0 onward — the
// workflow runs a bare `npm run setup` — and the README's own build steps with
// it. The models are a runtime choice now, but fetching one is still the
// sensible thing to do when nobody named one.
else if (!want) toFetch = [DEFAULT_MODEL];
else {
  const pick = names.find((n) => want.includes(n));
  if (!pick) throw new Error(`Unknown model "${process.argv.slice(2).join(' ')}". Use: ${names.join(', ')}, all or clean.`);
  toFetch = [pick];
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** A download is accepted when its size matches what the server promised.
 * Not sha256: HuggingFace's CDN tags files with a storage key that is not the
 * content hash (checked on a 2 KB config.json), so ETag matching rejects
 * good downloads. Size plus onnxruntime successfully loading the file is the
 * practical gate.
 */
async function verify(path, got, expected) {
  if (expected && got !== expected) {
    throw new Error(`${path} came down at ${got} bytes, expected ${expected}`);
  }
}

async function sizeOf(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return -1;
  }
}

/** Tries HuggingFace, then the Blab mirror. Returns the first one that answers. */
async function open(remote, model) {
  const sources = [`${HOST}/${model}/resolve/main/${remote}`];
  if (model === MIRROR_MODEL) sources.push(`${MIRROR}/${remote.split('/').pop()}`);

  let last = 'no sources';
  for (const url of sources) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.ok && res.body) return res;
      last = `${res.status} ${res.statusText}`;
    } catch (err) {
      last = err.message;
    }
  }
  throw new Error(`${remote} could not be fetched from any source (${last})`);
}

async function download(remote, model, local) {
  await mkdir(dirname(local), { recursive: true });
  const tmp = `${local}.part`;

  // Resume: a dropped connection is normal on some networks, and the partial
  // file is a good start, not garbage. Ask the server for the rest of it.
  const have = await sizeOf(tmp);
  if (have > 0) {
    try {
      const range = await fetch(`${HOST}/${model}/resolve/main/${remote}`, {
        headers: { Range: `bytes=${have}-` },
        redirect: 'follow',
      });
      if (range.ok && range.status === 206 && range.body) {
        const append = createWriteStream(tmp, { flags: 'a' });
        await pipeline(Readable.fromWeb(range.body), append);
        const got = await sizeOf(tmp);
        const total = Number((range.headers.get('content-range') ?? '').split('/')[1]);
        if (total && got !== total) {
          throw new Error(`${remote} resumed but came down short: ${got} of ${total} bytes`);
        }
        process.stdout.write(`  resume  ${remote} from ${mb(have)} … `);
        await verify(tmp, got, total || 0);
        console.log(mb(got));
        await copyFile(tmp, local);
        const { unlink } = await import('node:fs/promises');
        await unlink(tmp);
        return got;
      }
      // A 200 means the server ignored the range; fall through to a full
      // download rather than appending to a file that is now a mix.
    } catch {
      // Range failed for an uninteresting reason; start over.
    }
  }

  const res = await open(remote, model);
  const expected = Number(res.headers.get('content-length')) || 0;

  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));

  const got = await sizeOf(tmp);
  await verify(tmp, got, expected || got);
  // Rename last, so an interrupted run never leaves a half file looking done.
  await copyFile(tmp, local);
  const { unlink } = await import('node:fs/promises');
  await unlink(tmp);
  return got;
}

async function copyOrt() {
  const from = join(ROOT, 'node_modules', 'onnxruntime-web', 'dist');
  const to = join(ROOT, 'public', 'ort');
  await mkdir(to, { recursive: true });

  let bytes = 0;
  for (const name of ORT_FILES) {
    const target = join(to, name);
    const source = join(from, name);
    const have = await sizeOf(target);
    const want = await sizeOf(source);
    if (want < 0) throw new Error(`Missing ${source}. Run \`npm install\` first.`);
    if (have !== want) {
      await copyFile(source, target);
      console.log(`  copied  ${name}  ${mb(want)}`);
    } else {
      console.log(`  have    ${name}`);
    }
    bytes += want;
  }
  return bytes;
}

async function fetchModel(name) {
  const model = MODELS[name];
  const to = join(ROOT, 'public', 'models', ...model.split('/'));
  let bytes = 0;
  for (const file of MODEL_FILES) {
    const target = join(to, file);
    const have = await sizeOf(target);
    if (have > 0) {
      console.log(`  have    ${model}/${file}`);
      bytes += have;
      continue;
    }
    process.stdout.write(`  get     ${model}/${file} … `);
    const got = await download(file, model, target);
    console.log(mb(got));
    bytes += got;
  }
  return bytes;
}

async function fetchVad() {
  const to = join(ROOT, 'public', 'models', VAD.org, VAD.model, VAD.file);
  const have = await sizeOf(to);
  if (have > 0) {
    console.log(`  have    ${VAD.org}/${VAD.model}/${VAD.file}`);
    return 0;
  }
  const got = await download(VAD.file, `${VAD.org}/${VAD.model}`, to);
  console.log(`  get     ${VAD.org}/${VAD.model}/${VAD.file}  ${mb(got)}`);
  return got;
}

async function dropOtherModels(keep) {
  const root = join(ROOT, 'public', 'models');
  for (const org of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!org.isDirectory()) continue;
    for (const name of await readdir(join(root, org.name), { withFileTypes: true }).catch(() => [])) {
      const path = join(root, org.name, name.name);
      if (!name.isDirectory() || keep.includes(`${org.name}/${name.name}`)) continue;
      await rm(path, { recursive: true, force: true });
      console.log(`  removed ${org.name}/${name.name}`);
    }
  }
}

console.log(`\nonnxruntime wasm -> public/ort`);
const ortBytes = await copyOrt();

console.log(`\nsilero voice-activity detector -> public/models`);
const vadBytes = await fetchVad();

if (toFetch.length) {
  const label = toFetch.length === 1 ? toFetch[0] : toFetch.join(' + ');
  console.log(`\nwhisper (${label}) -> public/models`);
} else {
  console.log(`\ncleaning: removing every model but ${MODELS.base}`);
}
let total = 0;
for (const name of toFetch) {
  total += await fetchModel(name);
}
// The prune exists so that swapping models does not leave dead weights in
// public/models for electron-builder to bake into the installer. It takes the
// list of what to KEEP, and both callers used to get that list wrong.
//
// `all` passed [], which does not mean "keep the lot" — it means keep nothing,
// so a gigabyte of models was downloaded and then deleted on the line after.
// The installer built from it carried no Whisper model at all, and setup still
// printed "all on disk" on its way out.
//
// The VAD is not a Whisper model and is never what the argument is about, so
// it is kept either way; `clean` used to drop it too.
const VAD_REPO = `${VAD.org}/${VAD.model}`;
if (want === 'clean') await dropOtherModels([MODELS.base, VAD_REPO]);
else if (want === 'all') await dropOtherModels([...names.map((n) => MODELS[n]), VAD_REPO]);

const modelTotal = total === 0 ? 'model files already present' : mb(total);
console.log(`\nReady. ${modelTotal}, ${mb(ortBytes + vadBytes)} of runtime, all on disk.`);
console.log('Blab needs no network from here on. Start it with `npm run dev`.');
