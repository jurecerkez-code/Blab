// The one network moment. Run once: `npm run setup`.
// Pulls the Whisper model into public/models and the onnxruntime wasm binaries
// into public/ort. After this, Blab never touches the network again.
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'https://huggingface.co';

// Every file below lives on someone else's server, and one day someone else
// will move it. The same files are attached to a Blab release that never
// changes, so a dead upstream URL costs a retry instead of the whole app.
// Only whisper-base is mirrored; swap MODEL and you are back to one source.
const MIRROR_MODEL = 'Xenova/whisper-base';
const MIRROR = 'https://github.com/jurecerkez-code/Blab/releases/download/model-mirror';

// Read the model out of the worker rather than repeating it here, so switching
// to whisper-tiny is a one-line change that cannot fall out of step.
const WORKER = join(ROOT, 'src', 'worker.ts');
const MODEL = /^const MODEL = '([^']+)'/m.exec(await readFile(WORKER, 'utf8'))?.[1];
if (!MODEL) throw new Error(`Could not find the MODEL constant in ${WORKER}.`);

// Matches the worker: device 'wasm' + dtype 'q8' -> the "_quantized" weights.
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

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

async function sizeOf(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return -1;
  }
}

/** Tries HuggingFace, then the Blab mirror. Returns the first one that answers. */
async function open(remote) {
  const sources = [`${HOST}/${MODEL}/resolve/main/${remote}`];
  if (MODEL === MIRROR_MODEL) sources.push(`${MIRROR}/${remote.split('/').pop()}`);

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

async function download(remote, local) {
  const res = await open(remote);
  const expected = Number(res.headers.get('content-length')) || 0;

  await mkdir(dirname(local), { recursive: true });
  const tmp = `${local}.part`;
  await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));

  const got = await sizeOf(tmp);
  if (expected && got !== expected) {
    throw new Error(`${remote} came down short: ${got} of ${expected} bytes`);
  }
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

async function fetchModel() {
  const to = join(ROOT, 'public', 'models', ...MODEL.split('/'));
  let bytes = 0;
  for (const name of MODEL_FILES) {
    const target = join(to, name);
    const have = await sizeOf(target);
    if (have > 0) {
      console.log(`  have    ${name}`);
      bytes += have;
      continue;
    }
    process.stdout.write(`  get     ${name} … `);
    const got = await download(name, target);
    console.log(mb(got));
    bytes += got;
  }
  return bytes;
}

console.log(`\nonnxruntime wasm -> public/ort`);
const ortBytes = await copyOrt();

console.log(`\n${MODEL} -> public/models`);
const modelBytes = await fetchModel();

console.log(
  `\nReady. ${mb(modelBytes)} of model, ${mb(ortBytes)} of runtime, all on disk.` +
    `\nBlab needs no network from here on. Start it with \`npm run dev\`.\n`,
);
