# Blab

Record a talk. Type your notes while it runs. Press stop and it writes the
transcript on your own computer.

No account. No login. No cloud. No API key. No subscription. Nothing leaves
your machine.

Windows and Mac. Free. One feature.

## Download

| Your computer | File | What to do |
|---------------|------|------------|
| **Windows PC** | `Blab-Setup-0.2.1.exe` | Run it. Windows shows a warning. Click **More info**, then **Run anyway** |
| **Mac** | `Blab-0.2.1.dmg` | Open it, drag Blab into Applications. First time only: double click Blab, click **Done**, then go to **System Settings → Privacy & Security** and click **Open Anyway** |

Both from the [releases page](https://github.com/jurecerkez-code/Blab/releases/latest).
One file for every Mac, old or new. You do not need to know which chip is in
your computer.

### About that warning

Nothing is wrong with the file. Windows and Mac both shout at any app whose
author has not paid them a yearly fee. Apple wants 99 dollars a year, Microsoft
wants a few hundred euros.

Blab makes no money, so it pays nobody, so you get one warning screen on the
way in.

On Mac that screen is titled **"Blab" Not Opened** and says Apple could not
verify Blab is free of malware. The only two buttons are **Move to Trash** and
**Done**. There is no Open button, and this is the part that catches people:

1. Click **Done**. Not Move to Trash.
2. Open **System Settings**, go to **Privacy & Security**, scroll to the
   bottom. There is a line about Blab with an **Open Anyway** button.
3. Click it, enter your Mac password, and confirm.

It never asks again.

Older guides tell you to right click the app and choose Open. That stopped
working in macOS 15. On anything newer, System Settings is the only way
through.

If you do not want to trust that, the source is right here and you can build it
yourself.

### Why the file is so big

The speech model is inside it. 153 MB on Windows, 276 MB on Mac. The Mac one is
bigger because it holds a version for both Apple and Intel chips in one file.

Once it is installed, Blab downloads nothing, ever. The first launch takes
about ten seconds while the model loads. Every launch after that is two or
three.

Linux is not built yet.

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

You need [Node.js](https://nodejs.org) 20 or newer, and you can only build for
the system you are sitting at. Windows makes the exe, a Mac makes the dmg.

```
git clone https://github.com/jurecerkez-code/Blab.git
cd Blab
npm install
npm run setup
npm run package
```

That writes the installer for whatever machine you ran it on into the folder.

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

One warning about the microphone line. Started from a terminal, Blab inherits
whatever microphone permission that terminal already has, so the line reads
`ok` on a build that cannot record a thing once it is launched normally. A
0.2.0 shipped that way: every recording on a Mac was silence, the file was the
right size and shape, and Whisper wrote `you`, which is what it writes for an
empty room. `app:check` said `ok` throughout.

It is still worth running for the other three. To trust the microphone, open
the app from Finder or the Start menu, record yourself saying something you can
check, and read the transcript back.

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
