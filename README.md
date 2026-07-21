# Blab

Record a talk. Type your notes while it runs. Press stop and it writes the
transcript on your own computer.

No account. No login. No cloud. No API key. No subscription. Nothing leaves
your machine.

Windows. Free. One feature.

## Download

Grab [Blab-Setup-0.1.0.exe](https://github.com/jurecerkez-code/Blab/releases/latest)
and run it. That is the install.

Windows will say "Windows protected your PC" because the installer is not
signed. Click **More info**, then **Run anyway**. Once, and never again. A
certificate that removes that screen costs a few hundred euros a year, and
nothing else about Blab costs anything, so it stays unsigned.

The file is 236 MB because the speech model is inside it. After you install it,
Blab downloads nothing, ever.

## Using it

Pick one folder the first time. One folder for everything you will ever record.

Type a title. Press **Record**. Type your notes while it listens. Press
**Stop**.

That is the whole thing.

Do not make folders inside it yourself. Blab names them, and a folder it did
not name is invisible to it.

Click any old recording to read it, play it back, or press **Copy all**. That
puts the title, your notes and the transcript on your clipboard as one block.
Paste it into an AI, an email, or wherever it needs to go.

## Where your stuff goes

```
your-folder/
  2026-06-14_1030_judge-talk/
    audio.webm
    notes.md
    transcript.md
```

Plain files. No database, no index, no hidden state.

Open them in any editor. Search them with anything. Back them up by copying the
folder. Blab does not need to be running. Blab does not need to exist.

The folder name is `date_time_title`, so titles come back as slugs. "API
Workshop" shows up as "Api workshop" in the list. The files are what matter.
That is the price of not keeping a separate index.

## How long can a talk be

There is no limit. Whisper reads the audio in 30 second chunks, so three hours
works the same way three minutes does. It takes longer, that is all.

Memory is the real ceiling. An hour of audio is around 230 MB while it works.
A couple of hours in one recording is comfortable. Half a day is asking for
trouble.

Speed is about 3.5x faster than real time. A 45 minute talk takes roughly 13
minutes. It runs in the background, so you can start recording the next talk
while the last one is still going.

Want it faster? Change one line. `MODEL` at the top of `src/worker.ts`, set it
to `Xenova/whisper-tiny`, run `npm run setup` again. Tiny is about 3x faster
and noticeably worse.

## Does it phone home

No, and not because this file says so.

The app runs under `Content-Security-Policy: connect-src 'self'`. It cannot
open a connection to any other server. The engine refuses before a request
happens. You do not have to trust me on it, you can go and try to break it.

The rest, if you want to check:

- The transcriber runs with `allowRemoteModels = false`. A missing file makes
  it fail loudly instead of quietly fetching one.
- The window has no Node access and runs sandboxed.
- USB, HID and serial devices are refused outright.
- Three permissions are granted. Microphone, the folder you picked, clipboard.
- `npm run setup` is the only code here that downloads anything. It runs once,
  while you build. It is 130 lines and you can read all of them.

Your audio, your notes and your transcripts stay in your folder.

## Building it yourself

You need [Node.js](https://nodejs.org) 20 or newer.

```
git clone https://github.com/jurecerkez-code/Blab.git
cd Blab
npm install
npm run setup
npm run package
```

That writes `Blab-Setup-0.1.0.exe` into the folder.

`npm run setup` is the only network moment in the whole project. It pulls the
Whisper model from HuggingFace, with the same files copied onto a Blab release
as a backup, so setup keeps working even if those URLs move one day.

Other commands:

```
npm run app        build and open the app, no installer
npm run app:check  prove the microphone, model and threads work
npm run dev        same app in a browser tab, Chrome or Edge only
```

`app:check` is the useful one. It opens the app, asks for the microphone, and
pushes two seconds of silence through the real Whisper worker. Four lines, and
it exits non zero if any of them failed:

```
threads (SharedArrayBuffer): true
microphone: ok: Default - Microphone Array (Realtek(R) Audio)
whisper weights: ok: 23200850 bytes
end to end: ok: loaded and transcribed 2s in 6s
```

Run that before you ship anything.

The browser version needs the File System Access API to write to your folder,
which Firefox and Safari do not have. It also cannot get the microphone inside
an embedded preview pane. The desktop app has neither problem.

### If packaging fails

`Cannot create symbolic link` means electron-builder pulled a signing bundle
full of macOS symlinks and Windows will not create them without admin rights.
None of it is needed here. Extract it yourself once, skipping the macOS half:

```
curl -L -o wcs.7z https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z
node_modules/7zip-bin/win/x64/7za.exe x wcs.7z -o"%LOCALAPPDATA%/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0" -xr!darwin
```

Then run `npm run package` again.

## How it is built

Vite and plain TypeScript in an Electron window. No framework, no UI library,
no state library. The one real dependency is `transformers.js`, and it is
bundled instead of loaded from a CDN.

```
electron/
  main.cjs        the desktop shell. one window, strict policy, yes to the mic
src/
  main.ts         the one screen and all its wiring
  vault.ts        reading and writing the folder
  recorder.ts     MediaRecorder
  audio.ts        webm into mono 16 kHz samples, what Whisper wants
  transcriber.ts  talks to the worker, queues jobs
  worker.ts       Whisper itself, off the main thread
  store.ts        remembers which folder you picked
scripts/
  setup.mjs       the one network moment
  icon.mjs        renders the app icon
  package.mjs     builds the installer and puts it where you can find it
```

Browser storage holds exactly one thing. The handle for your folder. Folder
handles cannot go into localStorage, and it is the only way to remember your
choice between runs. Nothing about your recordings is kept in the app.

## Contributing

Fork it. Pull requests welcome.

Blab has one feature on purpose. The question for any change is whether someone
recording a talk would notice it.

Things that fit: other platforms, better accuracy, faster transcription, fewer
steps.

Things that do not: accounts, sync, a server, analytics, a plugin system, or
anything that needs the internet while it runs.

Small and finished beats big and maintained. It should still work in ten years
with nobody touching it.

## Licence

MIT. Do what you want with it.
