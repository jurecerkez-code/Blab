// Blab as a desktop app. This file is the whole shell: it opens one window,
// serves the built app to it, and says yes to the microphone. The app inside
// is byte-for-byte the same one `npm run dev` serves.
const { app, BrowserWindow, protocol, net, session, shell } = require('electron');
const path = require('node:path');
const { readdir, stat } = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

const DEV = process.argv.includes('--dev');
// `npm run app:check` — proves the microphone and the threaded wasm work here,
// without making the user record a talk to find out.
const DIAG = process.argv.includes('--diagnose');
const DEV_URL = 'http://localhost:5173/';
const DIST = path.join(__dirname, '..', 'dist');

// The threaded wasm Whisper runs on needs SharedArrayBuffer, which needs a
// cross-origin isolated page, which needs real response headers. file:// has
// no headers, so the app is served over a private scheme instead.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'blab',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

// `connect-src 'self'` is the interesting line: it makes "Blab never touches
// the network" something the runtime enforces rather than something the README
// promises. wasm-unsafe-eval is onnxruntime; blob: workers are its threads;
// blob: media is the audio player; inline styles are set from script.
const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.svg': 'image/svg+xml',
};

function serveDist() {
  protocol.handle('blab', async (request) => {
    const { pathname } = new URL(request.url);
    const rel = pathname === '/' ? '/index.html' : pathname;
    const file = path.normalize(path.join(DIST, decodeURIComponent(rel)));
    // A private scheme is still a URL; do not let one escape dist/. The
    // separator matters: without it a sibling named dist-anything would pass.
    if (!file.startsWith(DIST + path.sep)) return new Response('Forbidden', { status: 403 });

    let size;
    try {
      size = (await stat(file)).size;
    } catch {
      return new Response('Not found', { status: 404 });
    }

    const headers = new Headers({
      'Content-Security-Policy': CSP,
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      // The worker HEADs the weights and reads this to tell a real model from a
      // fallback page. file:// does not always carry it, so set it from disk.
      'Content-Length': String(size),
    });

    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
    const res = await net.fetch(pathToFileURL(file).toString());
    return new Response(res.body, { status: res.status, headers });
  });
}

// In a browser these are prompts. Here the user already chose to run Blab, and
// nothing it asks for reaches the network, so the answer is yes — for this
// short list only.
const ALLOWED = new Set(['media', 'audioCapture', 'fileSystem', 'clipboard-sanitized-write', 'clipboard-read']);

function allowLocalPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, done) => done(ALLOWED.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED.has(permission));
  // Blab talks to no USB, HID or serial device. Saying no to all of them costs
  // nothing and removes the whole class of question.
  ses.setDevicePermissionHandler(() => false);
}

/** Only ever hand the operating system a web address. */
function openInBrowser(url) {
  const scheme = (() => {
    try {
      return new URL(url).protocol;
    } catch {
      return null;
    }
  })();
  if (scheme === 'http:' || scheme === 'https:') void shell.openExternal(url);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 980,
    height: 860,
    minWidth: 560,
    minHeight: 520,
    title: 'Blab',
    backgroundColor: '#14140f',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(DEV ? DEV_URL : 'blab://app/');
  if (DIAG) void diagnose(win);

  // Blab never navigates anywhere. Anything that tries is a link, and links
  // belong in the real browser, not in this window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
      openInBrowser(url);
    }
  });
  // A renderer process has no business spawning anything.
  win.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

async function diagnose(win) {
  await new Promise((done) => win.webContents.once('did-finish-load', done));

  // The worker chunk is content-hashed, so find it rather than hardcode it.
  const assets = await readdir(path.join(DIST, 'assets')).catch(() => []);
  const workerFile = assets.find((n) => /^worker-.*\.js$/.test(n));

  const report = await win.webContents.executeJavaScript(`(async () => {
    const out = { threads: crossOriginIsolated, mic: null, model: null, whisper: null };

    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      out.mic = 'ok: ' + (s.getAudioTracks()[0]?.label || 'unnamed device');
      s.getTracks().forEach((t) => t.stop());
    } catch (e) { out.mic = 'FAILED: ' + e.name + ' ' + e.message; }

    try {
      const r = await fetch('/models/Xenova/whisper-base/onnx/encoder_model_quantized.onnx', { method: 'HEAD' });
      out.model = r.ok ? 'ok: ' + r.headers.get('content-length') + ' bytes' : 'FAILED: HTTP ' + r.status;
    } catch (e) { out.model = 'FAILED: ' + e.message; }

    // Two seconds of silence through the real worker. Slow, but it exercises
    // the content security policy, the wasm threads and the weights at once —
    // the three things that break quietly.
    const workerFile = ${JSON.stringify(workerFile ?? null)};
    if (!workerFile) {
      out.whisper = 'FAILED: no worker chunk in dist/assets — run npm run build';
    } else {
      try {
        const w = new Worker(new URL('assets/' + workerFile, document.baseURI), { type: 'module' });
        const started = performance.now();
        out.whisper = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve('FAILED: still running after 180s'), 180000);
          w.onerror = (e) => { clearTimeout(timer); resolve('FAILED: ' + (e.message || 'worker error')); };
          w.onmessage = (e) => {
            const m = e.data;
            if (m.type === 'done') {
              clearTimeout(timer);
              resolve('ok: loaded and transcribed 2s in ' + Math.round((performance.now() - started) / 1000) + 's');
            } else if (m.type === 'failed') {
              clearTimeout(timer);
              resolve('FAILED: ' + m.message);
            }
          };
          const audio = new Float32Array(16000 * 2);
          w.postMessage({
            type: 'transcribe',
            id: 'diagnose',
            audio,
            modelPath: new URL('models/', document.baseURI).href,
            ortPath: new URL('ort/', document.baseURI).href,
          }, [audio.buffer]);
        });
        w.terminate();
      } catch (e) { out.whisper = 'FAILED: ' + e.message; }
    }
    return out;
  })()`);

  console.log('threads (SharedArrayBuffer):', report.threads);
  console.log('microphone:', report.mic);
  console.log('whisper weights:', report.model);
  console.log('end to end:', report.whisper);
  const ok = [report.mic, report.model, report.whisper].every((line) => line.startsWith('ok'));
  app.exit(ok ? 0 : 1);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    allowLocalPermissions();
    if (!DEV) serveDist();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => app.quit());
}
