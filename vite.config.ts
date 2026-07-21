import { defineConfig } from 'vite';

// SharedArrayBuffer (used by onnxruntime's threaded wasm) needs a cross-origin
// isolated page. These headers cost nothing here: the app loads no remote
// resources at all.
const headers = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/**
 * onnxruntime references its wasm through import.meta.url, so Rollup emits a
 * 21 MB copy into assets/ that nothing ever loads — the worker points
 * wasmPaths at the vendored /ort/ copy instead. Drop the duplicate.
 */
const dropUnusedOrtWasm = {
  name: 'drop-unused-ort-wasm',
  generateBundle(_options: unknown, bundle: Record<string, unknown>) {
    for (const file of Object.keys(bundle)) {
      if (/ort-wasm.*\.wasm$/.test(file)) delete bundle[file];
    }
  },
};

export default defineConfig({
  plugins: [dropUnusedOrtWasm],
  server: { headers },
  preview: { headers },
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
