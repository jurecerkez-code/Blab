# Blab

Record a talk. Type your notes while it runs. Press stop and it writes the
transcript on your own computer.

No account. No login. No cloud. No API key. No subscription. Nothing leaves
your machine.

Windows, Mac and Linux. Free. One feature.

## Download

Everything is on the [releases page](https://github.com/jurecerkez-code/Blab/releases/latest).

| Your computer | File | What to do |
|---------------|------|------------|
| **Windows** | `Blab-Setup-*.exe` | Run it. You get [a warning](#the-warning-on-windows-and-mac) — it is expected |
| **Mac** | `Blab-*.dmg` | Open it, drag Blab into Applications. You get [a warning](#the-warning-on-windows-and-mac) — it is expected |
| **Linux** | `Blab-*.AppImage` | `chmod +x Blab-*.AppImage && ./Blab-*.AppImage --no-sandbox` |

One Mac file works on every Mac, old or new — you do not need to know which
chip is in yours. The Linux file installs nothing and needs no package
manager.

### Or one command

Same command on all three systems but the name of the shell. It finds the
latest release, downloads the one file for your machine, and puts it where
that system expects an app to live.

**Mac and Linux**

```
curl -fsSL https://raw.githubusercontent.com/jurecerkez-code/Blab/main/scripts/install.sh | sh
```

**Windows**, in PowerShell

```
irm https://raw.githubusercontent.com/jurecerkez-code/Blab/main/scripts/install.ps1 | iex
```

Mac: lands in Applications. Linux: you get `blab` on your path and an entry in
your menu. Windows: the normal installer runs, Blab turns up in the Start menu.
None of them asks for an administrator password — Blab installs for one user
and needs nothing from the system.

On Linux this is the route to prefer: it handles both Linux quirks below for
you. On Mac it skips the warning screen entirely, because that screen is shown
to files a *browser* downloaded and `curl` does not mark them the same way.
Nothing is switched off to manage that.

Both scripts are short, they live in `scripts/`, and reading one before piping
it into a shell is a reasonable thing to want to do.

## If something goes wrong

| What you see | What to do |
|--------------|------------|
| **Windows:** "Windows protected your PC" | **More info** → **Run anyway**. [Why](#the-warning-on-windows-and-mac) |
| **Mac:** "Blab" Not Opened, and no Open button | **Done**, then System Settings → Privacy & Security → scroll to the bottom → **Open Anyway**. [Why](#the-warning-on-windows-and-mac) |
| **Linux:** `dlopen(): error loading libfuse.so.2` | `sudo apt install libfuse2`, or run it as `APPIMAGE_EXTRACT_AND_RUN=1 ./Blab-*.AppImage --no-sandbox`. [Why](#the-two-linux-quirks) |
| **Linux:** it refuses to start from a terminal | Add `--no-sandbox`. [Why](#the-two-linux-quirks) |
| The bars stay flat while you talk | Blab cannot hear you. Wrong microphone, muted, or unplugged. Fix it *now*, not after the talk |
| The transcript repeats one phrase forever | Whisper got stuck, because the microphone was too far away. Blab tells you when this happens. [What to do about it](#when-the-room-beats-the-microphone) |
| The transcript is thin, or full of near-words | Same cause. Get within two or three metres of the speaker |
| A folder you made yourself is not in the list | Blab only sees folders it named. Do not make them by hand |
| `Unable to decode audio data` on a long recording | A bug fixed in 0.3.2. Update |
| First launch takes ten seconds | The model is loading. Every launch after that is two or three |

### The warning on Windows and Mac

Nothing is wrong with the file. Windows and Mac both shout at any app whose
author has not paid them a yearly fee — Apple wants 99 dollars a year,
Microsoft a few hundred euros. Blab makes no money, so it pays nobody, so you
get one warning screen on the way in. It never asks again.

On Mac the screen is titled **"Blab" Not Opened** and offers only **Move to
Trash** and **Done**. There is no Open button, and this is the part that
catches people: click **Done**, then go to System Settings → Privacy &
Security, scroll to the bottom, and click **Open Anyway** beside Blab.

Older guides say to right click the app and choose Open. That stopped working
in macOS 15.

Linux asks for none of this. If you do not want to trust any of it, the source
is right here and you can [build it yourself](#building-it-yourself).

### The two Linux quirks

Neither is Blab's doing, and the [one command installer](#or-one-command)
handles both.

**FUSE.** An AppImage is a small filesystem the runtime mounts, which needs
FUSE, and Ubuntu has not shipped `libfuse2` since 22.04. Install it, or tell
the runtime to unpack itself instead:

```
APPIMAGE_EXTRACT_AND_RUN=1 ./Blab-*.AppImage --no-sandbox
```

**The sandbox.** Chromium's sandbox needs a small root-owned helper, and an
AppImage is a single unprivileged file that cannot ship one, so
electron-builder switches it off. The menu entry passes `--no-sandbox` for you;
a bare run from a terminal does not, so on Ubuntu 24.04 it refuses to start
until you pass it yourself. Nothing else changes: the window still has no Node
access and `connect-src 'self'` still forbids the network, on Linux exactly as
on the other two.

## Using it

Pick one folder the first time — one folder for everything you will ever
record. Type a title. Press **Record**. Type your notes while it listens.
Press **Stop**. That is the whole thing.

**The bars.** A row under the button moves with your voice. It exists because a
microphone that is muted or pointed at the wrong device looks exactly like a
working one until you press Stop and read an empty transcript.

**Pause.** A break in a lecture does not have to become two recordings.
Pausing keeps the microphone and the file open and writes nothing in between,
so the break costs no disk and no transcription time. The timer counts recorded
time, not time since you pressed Record.

**Nothing is written until Stop**, so closing the window, quitting and
reloading all ask first rather than throwing away a live recording. The machine
is also asked to stay awake, so a lecture does not end early because a laptop
decided it was idle.

**Afterwards.** Click any old recording to read it, play it back, or press
**Copy all** — title, notes and transcript on your clipboard as one block, ready
to paste into an AI or an email. **Save .md** and **Save .txt** write the same
block as a file.

Every line says when it happened, and clicking one plays the audio from that
second. That works for your own notes too, which is the useful half: you wrote
"ask him about the deadline" at fourteen minutes, so click it and hear what was
actually said at fourteen minutes.

## Where your stuff goes

```
your-folder/
  2026-06-14_1030_judge-talk/
    audio.webm
    notes.md
    transcript.md
```

Plain files. No database, no index, no hidden state. Open them in any editor,
search them with anything, back them up by copying the folder. Blab does not
need to be running. Blab does not need to exist.

Both text files carry the time each line belongs to, counted from the start:

```
[00:00] Right, we should probably get started.
[00:31] The first thing is the database migration.
```

The times are the same numbers in both files, so a note at `[14:20]` and a
transcript line at `[14:20]` are the same moment of audio. They line up even
when the talk had a break in it, because a pause writes nothing.

Your notes split where you stopped typing — each time you come back is a new
line with its own time, so you do not have to press Enter, and a paragraph you
never broke up is not one moment. Pressing Enter splits it too, immediately.

The folder name is `date_time_title`, so titles come back as slugs: "API
Workshop" shows up as "Api workshop". That is the price of not keeping a
separate index. The files are what matter.

## Worth going back to

Above the transcript is a short list of lines from the talk. Not a summary — a
shortlist. Every line was said out loud, is quoted whole, and carries the time
it was said at, so you can click one and hear it.

No model writes it, and that is a choice. A language model small enough to ship
inside this installer would write smoother paragraphs and would also, on
exactly the transcripts that are already hard to trust, state decisions nobody
took. A wrong pick here costs you one dull line, and you can go and check it.

Two things decide the list: what the talk keeps coming back to (a word said
forty times is the subject, a word said once is an aside), and where you were
typing — no statistic beats someone who was in the room. Recordings under a
couple of minutes get nothing; there is no shape in them to find.

If you want real minutes, press **Copy all** and paste it into a large model.
Blab does the part that has to happen on your machine, and does not pretend a
0.6 billion parameter model is the same thing as a good one.

## What it writes, and how well

**English only**, and there is no picker to get wrong. Until 0.5.0 there was
one, offering English or Croatian, and it was a trap: the language cannot be
detected, so it had to be pinned by hand, and picking the wrong one does not
give you a worse transcript — it gives you wreckage. An English recording with
Croatian selected came back as one real sentence followed by two thousand words
of "ti ti ki ki pi ti". That is a setting whose wrong value destroys the
recording, offered to someone who has just finished a lecture. So it is gone.
Croatian is a real loss for anyone who used it; the model still knows it, and
the way back is in the git history at v0.5.0.

**No limit on length.** Whisper reads the audio in 30 second chunks, so three
hours works the same way three minutes does. It just takes longer. Memory is
the real ceiling: an hour is around 230 MB while it works, a couple of hours is
comfortable, half a day is asking for trouble.

**Speed is about 3.5x faster than real time** — a 45 minute talk takes roughly
13 minutes. It runs in the background, so you can start recording the next talk
while the last one is still going.

**Want it faster or better?** Change one line: `MODEL` at the top of
`src/worker.ts`, then run `npm run setup` again. `Xenova/whisper-tiny` is about
3x faster and noticeably worse; `Xenova/whisper-small` is several times bigger
and slower, and the installer grows with it. Adding `.en` gets the
English-only tier, which is worth measuring on your own vocabulary rather than
assuming — it was measured here and lost, so the multilingual model stayed.

### When the room beats the microphone

This is the one thing most likely to disappoint you, so it is worth being
straight about.

Whisper writes what it hears. Put a laptop at the back of a lecture hall and it
hears a room, not a speaker, and then it guesses — and its way of guessing is
repetition. One talk recorded here came back with a single phrase repeated 434
times, and 39% of the transcript inside loops like that.

Blab pushes back in three places. A ban on any six word run repeating, which
kills that kind of loop at its second repetition. A repetition penalty, because
four tokens rotating through each other give thousands of arrangements and none
of them is an exact repeat. And then a check: looping text compresses far too
well, so above a gzip ratio of 2.4 — ordinary speech sits between 1.5 and 2.0 —
the transcript is still saved and the app tells you plainly that Whisper got
stuck, rather than leaving you to find out at the bottom of the file. The
recording that prompted this scored 3.15.

What none of it can do is invent words the microphone never caught. That same
talk holds 60 words per minute of real speech where a well captured one holds
170. **So the fix is mostly physical: get within two or three metres of whoever
is speaking, or put any external microphone closer.** Earbuds on the table beat
a laptop across the room.

One part of it was Blab's own fault and is fixed. The microphone was opened
with `audio: true`, which takes the browser's defaults, and those are tuned for
a voice call: echo cancellation, noise suppression and automatic gain, all on.
Automatic gain lifts a quiet room until the meter looks healthy while mostly
amplifying the air conditioning. Noise suppression is worse — it gates short
broadband sounds, and the release of a consonant is a short broadband sound, so
it files the front off words. All three are now off, and the microphone reaches
Whisper the way Whisper was trained to hear it.

## Does it phone home

No, and not because this file says so.

The app runs under `Content-Security-Policy: connect-src 'self'`. It cannot
open a connection to any other server — the engine refuses before a request
happens. You do not have to trust me on it, you can go and try to break it.

The rest, if you want to check:

- The transcriber runs with `allowRemoteModels = false`. A missing file fails
  loudly instead of quietly fetching one.
- The window has no Node access, and runs sandboxed on Windows and Mac. The
  Linux AppImage cannot, [for the reason above](#the-two-linux-quirks).
- USB, HID and serial devices are refused outright.
- Three permissions are granted: microphone, the folder you picked, clipboard.
- Two things here download anything, and neither is the app. `npm run setup`
  fetches the model once while you build; the install scripts fetch one release
  file if you choose to install that way. All are short, and readable.

Your audio, your notes and your transcripts stay in your folder.

## Why the file is so big

The speech model is inside it: 153 MB on Windows, 187 MB on Linux, 276 MB on
Mac. The Mac one is bigger because it holds a version for both Apple and Intel
chips in one file. Once it is installed, Blab downloads nothing, ever.

## Building it yourself

You need [Node.js](https://nodejs.org) 20 or newer, and you can only build for
the system you are sitting at — Windows makes the exe, a Mac makes the dmg, a
Linux machine makes the AppImage.

```
git clone https://github.com/jurecerkez-code/Blab.git
cd Blab
npm install
npm run setup
npm run package
```

Needing two computers to cut one release is how 0.3.2 went out as an exe with
no dmg beside it. So pushing a tag now builds all three:

```
git tag v0.6.0
git push origin v0.6.0
```

GitHub lends out a Windows machine, a Mac and a Linux box, runs the same
`npm run package` on each, and leaves all three installers on a **draft**
release. Nothing is public until someone reads it and presses publish.
`.github/workflows/release.yml` is the whole of it, and you can run it by hand
from the Actions tab.

`npm run setup` is the only network moment in the whole project. It pulls the
Whisper model from HuggingFace, with the same files copied onto a Blab release
as a backup, so setup keeps working even if those URLs move.

Other commands:

```
npm run app        build and open the app, no installer
npm run app:check  prove the microphone, model and threads work
npm test           run the feature files against a real browser
npm run dev        same app in a browser tab, Chrome or Edge only
```

`npm test` needs its browser once, with `npx playwright install chromium`. It
drives Chrome with a fake microphone, so it can check that the bars actually
move rather than only that they exist — a window that is never drawn never runs
an animation frame, so that test needs a real browser to mean anything.

`app:check` opens the app, asks for the microphone, and pushes two seconds of
silence through the real Whisper worker. Four lines, and it exits non zero if
any of them failed:

```
threads (SharedArrayBuffer): true
microphone: ok: Default - Microphone Array (Realtek(R) Audio)
whisper weights: ok: 23200850 bytes
end to end: ok: loaded and transcribed 2s in 6s
```

Run it before you ship anything — but do not trust the microphone line on its
own. Started from a terminal, Blab inherits whatever permission that terminal
already has, so it reads `ok` on a build that cannot record a thing once
launched normally. 0.2.0 shipped that way: every recording on a Mac was
silence, and `app:check` said `ok` throughout. To trust the microphone, open
the app from Finder or the Start menu and record yourself saying something you
can check.

The browser version needs the File System Access API to write to your folder,
which Firefox and Safari do not have, and cannot get the microphone inside an
embedded preview pane. The desktop app has neither problem.

**If packaging fails on Windows** with `Cannot create symbolic link`,
electron-builder pulled a signing bundle full of macOS symlinks. None of it is
needed here — extract it yourself once, skipping the macOS half, then run
`npm run package` again:

```
curl -L -o wcs.7z https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z
node_modules/7zip-bin/win/x64/7za.exe x wcs.7z -o"%LOCALAPPDATA%/electron-builder/Cache/winCodeSign/winCodeSign-2.6.0" -xr!darwin
```

## How it is built

Vite and plain TypeScript in an Electron window. No framework, no UI library,
no state library. The one real dependency is `transformers.js`, bundled rather
than loaded from a CDN.

```
electron/
  main.cjs        the desktop shell. one window, strict policy, yes to the mic,
                  and it will not let a keystroke throw away a live recording
src/
  main.ts         the one screen and all its wiring
  vault.ts        reading and writing the folder
  recorder.ts     MediaRecorder
  meter.ts        the live bars, reading the recorder's own microphone stream
  audio.ts        webm into mono 16 kHz samples, what Whisper wants
  transcriber.ts  talks to the worker, queues jobs
  worker.ts       Whisper itself, off the main thread
  timeline.ts     the [mm:ss] prefix, written and read back
  notes.ts        when each line of your notes was typed
  highlights.ts   the shortlist, picked with arithmetic and no model
  store.ts        remembers your folder
scripts/
  setup.mjs       fetches the model, once, while you build
  icon.mjs        renders the app icon
  package.mjs     builds the installer and puts it where you can find it
  install.sh      one command install, for a Mac or a Linux box
  install.ps1     the same one for Windows
features/
  *.feature       what each feature is supposed to do, in plain English
tests/
  *.spec.ts       the same scenarios, executed
```

The meter watches the stream the recorder already opened rather than asking for
the microphone a second time, which would prompt macOS all over again and hold
a second device open for nothing.

Browser storage holds exactly one thing: the handle for your folder. Folder
handles cannot go into localStorage, which is why there is a database at all.
Nothing about your recordings is kept in the app.

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
