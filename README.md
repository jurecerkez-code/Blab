# Blab

Press Record at a talk. Blab records the room, you type your own notes, and
when you stop it turns the audio into text **on your own machine**. Everything
lands in a folder you pick, as plain files you own.

No account. No login. No cloud. No API key. No subscription. No telemetry. It
does one thing and it does not phone home — the app is not allowed to open a
network connection at all, which is enforced by the runtime and not just
promised here.

Windows. Free. One feature.

## Download

Grab **Blab-Setup-x.y.z.exe** from
[Releases](https://github.com/jurecerkez-code/Blab/releases/latest) and run it.
That is the whole installation. Blab lands on your desktop and in the Start
menu; open it like any other program.

The installer is unsigned, so the first run shows **"Windows protected your
PC"**. Click **More info**, then **Run anyway**. Once. Silencing that warning
permanently costs a few hundred euros a year for a certificate, and nothing
about Blab costs anything, so it stays unsigned. The file is about 230 MB
because the speech model is inside it — after installing, Blab never downloads
anything again.

## Using it

1. **Pick a folder.** One folder, once, for everything you will ever record.
   Do not create folders inside it yourself — Blab names them, and a folder it
   did not name is invisible to it.
2. Type a title, press **Record**, and type your notes while it listens.
3. Press **Stop**. Audio and notes are written immediately; the transcript
   follows in the background. The window stays usable — you can start the next
   talk while the last one is still transcribing.
4. Click any past recording to read it, play it, and press **Copy all** to put
   the title, your notes and the transcript on the clipboard as one block.
   Paste that straight into an AI, an email, or your own notes.

## What ends up on disk

```
your-folder/
  2026-06-14_1030_judge-talk/
    audio.webm
    transcript.md
    notes.md
  2026-06-14_1400_api-workshop/
    audio.webm
    transcript.md
    notes.md
```

That is the whole database. No index, no hidden state, no proprietary format.
Open the files in any editor, search them with anything, back them up by
copying the folder. Blab does not need to be running, or installed, or to still
exist.

The folder name is `date_time_title`, so the title is stored as a slug — "API
Workshop" comes back as "Api workshop" in the list. The files are what matter;
that is the price of not keeping a separate index.

## How long a talk can be

There is no built-in limit. Whisper reads the audio in 30-second chunks with a
5-second overlap, so a three-hour recording transcribes the same way a
three-minute one does — it just takes longer.

The real ceiling is memory. Decoded audio is about 64 KB per second, so an hour
is roughly 230 MB held while it works. On an ordinary laptop, a couple of hours
in one recording is comfortable and half a day is asking for trouble. Recording
each talk separately is both faster and easier to read later.

## Speed

Whisper `base` runs about 3.5x faster than real time on an ordinary laptop, so
a 45-minute talk takes roughly 13 minutes. It runs off the main thread and jobs
queue up, so nothing blocks.

Too slow? Change one constant — `MODEL` at the top of `src/worker.ts` — to
`Xenova/whisper-tiny`, then re-run `npm run setup`. The setup script reads the
name out of that file, so nothing else needs to stay in sync. Tiny is roughly
3x faster and noticeably less accurate.

## Privacy, precisely

Not a promise — a list of things you can check.

- The window is served from a private scheme with
  `Content-Security-Policy: connect-src 'self'`. The app cannot open a
  connection to any other host; the browser engine refuses before a request is
  made. See `electron/main.cjs`.
- The transcriber is configured with `allowRemoteModels = false`. If a model
  file is missing it fails loudly instead of quietly fetching one.
- The renderer runs sandboxed, with no Node access and no preload bridge.
- USB, HID and serial device access are refused outright. The only permissions
  granted are the microphone, the folder you picked, and the clipboard.
- `npm run setup` is the only code in the repository that downloads anything,
  it runs once at build time, and it is 120 lines you can read.

Your audio, notes and transcripts never leave the folder you chose.

## Building it yourself

You need [Node.js](https://nodejs.org) 20 or newer.

```
git clone https://github.com/jurecerkez-code/Blab.git
cd Blab
npm install
npm run setup     # ~76 MB Whisper model, downloaded once
npm run package   # writes Blab-Setup-x.y.z.exe into this folder
```

`npm run setup` is the only moment any of this touches the network. It puts the
Whisper model in `public/models/` and copies the onnxruntime wasm out of
`node_modules` into `public/ort/`. After that you can unplug the internet
permanently.

The model is fetched from HuggingFace, with the same files mirrored on a Blab
release as a fallback, so setup keeps working even if the upstream URLs move.

### Other commands

```
npm run app       # build and open the desktop app, without making an installer
npm run app:check # end-to-end proof: microphone, model, threads, real transcription
npm run dev       # the same app in a browser tab — Chrome or Edge only
```

`npm run app:check` is the one worth knowing. It opens the app, asks for the
microphone, and pushes two seconds of silence through the real Whisper worker,
then prints four lines and exits non-zero if any of them failed:

```
threads (SharedArrayBuffer): true
microphone: ok: Default - Microphone Array (Realtek(R) Audio)
whisper weights: ok: 23200850 bytes
end to end: ok: loaded and transcribed 2s in 6s
```

The browser version needs the File System Access API to write to your folder,
which Firefox and Safari do not have, and it cannot get the microphone inside
an embedded preview pane. The desktop app has neither problem.

### If packaging fails with "Cannot create symbolic link"

electron-builder downloads a code-signing bundle that contains macOS symlinks,
and Windows will not create symlinks without administrator rights. None of it
is needed here, so extract it once yourself, skipping the macOS half:

```
curl -L -o wcs.7z https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z
node_modules/7zip-bin/win/x64/7za.exe x wcs.7z -o"%LOCALAPPDATA%/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0" -xr!darwin
```

Then `npm run package` again.

## How it is built

Vite and vanilla TypeScript in an Electron window. No framework, no UI library,
no state library, no build plugins beyond one twenty-line rule. The only real
dependency is `transformers.js`, and it is bundled rather than loaded from a
CDN.

```
electron/
  main.cjs        the desktop shell — one window, a strict policy, yes to the mic
src/
  main.ts         the one screen and all its wiring
  vault.ts        reading and writing the folder
  recorder.ts     MediaRecorder
  audio.ts        webm -> mono 16 kHz samples, what Whisper wants
  transcriber.ts  talks to the worker, queues jobs
  worker.ts       Whisper itself, off the main thread
  store.ts        remembers which folder you picked
scripts/
  setup.mjs       the one network moment
  icon.mjs        renders the app icon
  place-installer.mjs  moves the built installer somewhere you can find it
```

Browser storage holds exactly one thing: the handle for your folder. Folder
handles cannot go in localStorage, and it is the only way to remember your
choice between runs. Nothing about your recordings is stored in the app.

## Contributing

Fork it and send a pull request. Blab has one feature on purpose, so the
question for any change is whether someone recording a talk would notice it.
Things that fit: other platforms, better accuracy, faster transcription, fewer
steps. Things that do not: accounts, sync, a server, analytics, a plugin
system, anything that needs a network connection at runtime.

Small and finished beats large and maintained. It should still work in ten
years without anyone touching it.

## Licence

MIT. Do what you like with it.
