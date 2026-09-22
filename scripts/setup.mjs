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
import { MODELS, VAD_REPO, plan } from './model-plan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'https://huggingface.co';

// The catalog and the fetch/keep decision live next door, in model-plan.mjs,
// because they are the part worth testing and this file downloads a gigabyte
// the moment it is imported. Only whisper-base is on the Blab mirror; the
// others come from HuggingFace (still one fetch, still cached forever after).
const MIRROR_MODEL = MODELS.base;
const MIRROR = 'https://github.com/jurecerkez-code/Blab/releases/download/model-mirror';

// The small voice-activity detector that lets transcription skip silence.
// Its repository path is the one in the plan, so the prune's keep-list and the
// download below can never drift into disagreeing about what it is called.
const [VAD_ORG, VAD_MODEL] = VAD_REPO.split('/');
const VAD = { org: VAD_ORG, model: VAD_MODEL, file: 'onnx/model_quantized.onnx' };

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

const { toFetch, keep } = plan(process.argv.slice(2));

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
// list of what to KEEP, which the plan works out and tests/setup.spec.ts pins
// down — a null keep-list means the models accumulate and nothing is removed.
if (keep) await dropOtherModels(keep);

const modelTotal = total === 0 ? 'model files already present' : mb(total);
console.log(`\nReady. ${modelTotal}, ${mb(ortBytes + vadBytes)} of runtime, all on disk.`);
console.log('Blab needs no network from here on. Start it with `npm run dev`.');
