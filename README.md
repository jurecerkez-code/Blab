# Blab

Record a talk. Type your notes while it runs. Press stop and it writes the
transcript on your own computer.

No account. No login. No cloud. No API key. No subscription. Nothing leaves
your machine.

Windows and Mac. Free. One feature.

## Download

| Your computer | File | What to do |
|---------------|------|------------|
| **Windows PC** | `Blab-Setup-*.exe` | Run it. Windows shows a warning. Click **More info**, then **Run anyway** |
| **Mac** | `Blab-*.dmg` | Open it, drag Blab into Applications. First time only: double click Blab, click **Done**, then go to **System Settings → Privacy & Security** and click **Open Anyway** |

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

While it records, a row of bars under the button moves with your voice. That
row exists for one reason: a microphone that is muted, unplugged, or pointed at
the wrong device looks exactly like a working one until you press Stop and read
an empty transcript. If the bars are flat while you are talking, Blab cannot
hear you. Fix it now rather than after the talk.

There is a **Pause** button beside Record. A break in the middle of a lecture
does not have to become two recordings: pausing keeps the microphone and the
file open and writes nothing in between, so the break costs no disk and no
transcription time. The timer counts recorded time rather than time since you
pressed Record, and the bars go flat while paused, because nothing is being
captured.

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

## What language it writes in

There is a picker in the top corner: **English** or **Croatian**.

Blab transcribes. It never translates. Speak Croatian with Croatian selected
and you get Croatian words back, not an English paraphrase of them. The model
that ships with Blab is multilingual, so this costs no extra download.

There is no Auto, on purpose. Whisper can detect the spoken language, but the
library Blab uses has not implemented detection yet — it quietly assumes
English. An Auto option would therefore be a lie: pick it, speak Croatian, get
English. Better to have two honest choices than three where one misleads.

Your choice is remembered, the same way your folder is. Set it once.

Accuracy in Croatian is noticeably below English. The model that ships is the
`base` tier, and Croatian is far less represented in its training, so it can
break words in odd places. See below for swapping in a larger model.

Only English and Croatian are listed because those are the two that have been
used in anger. The model knows 99 languages; adding one is a single line in
`index.html`.

## When the room beats the microphone

Whisper writes what it hears. Put a laptop at the back of a lecture hall and it
hears a room, not a speaker, and then it guesses.

Its way of guessing is repetition: it fastens onto a phrase and repeats it.
One talk recorded here came back with a single phrase repeated 434 times, and
39% of the whole transcript inside loops like that. Blab now forbids any six
word run from repeating, which cuts a loop off at its second repetition, so a
poor recording gives you a short honest transcript instead of a long worthless
one. It is also faster, because generating hundreds of repeated words was
costing real time.

What it cannot do is invent the words the microphone never caught. The same
talk holds 60 words per minute of real speech where a well captured one holds
170. No setting recovers the rest.

So the fix is physical. Get within two or three metres of whoever is speaking,
or put any external microphone closer — even earbuds on the table beat a laptop
across the room. And do not trust loud bars alone: the microphone's automatic
gain will happily raise a quiet room until the meter looks healthy while it is
mostly amplifying air conditioning.

## How long can a talk be

There is no limit. Whisper reads the audio in 30 second chunks, so three hours
works the same way three minutes does. It takes longer, that is all.

That was not true before 0.3.2, and it is worth saying why, because the failure
was silent and looked like a broken file. Recordings are Opus, which always
decodes at 48 kHz before being resampled down to the 16 kHz Whisper wants. The
browser did that in one piece, so a hundred minutes needed 1.16 GB in a single
allocation, and past roughly ninety minutes it refused — reporting `Unable to
decode audio data`, the same message a corrupt file gives. Long recordings now
decode packet by packet instead, so only ten minutes of audio is ever held at
48 kHz at once.

Memory is still the real ceiling, just a much higher one. An hour of audio is
around 230 MB while it works. A couple of hours in one recording is
comfortable. Half a day is asking for trouble.

Speed is about 3.5x faster than real time. A 45 minute talk takes roughly 13
minutes. It runs in the background, so you can start recording the next talk
while the last one is still going.

Want it faster? Change one line. `MODEL` at the top of `src/worker.ts`, set it
to `Xenova/whisper-tiny`, run `npm run setup` again. Tiny is about 3x faster
and noticeably worse.

Want it more accurate? Same line, `Xenova/whisper-small`. It is the better
trade if you record in anything other than English — Whisper's smaller tiers
learned far less of every other language, and Croatian in particular comes back
with words broken in odd places. Small is several times bigger and slower, and
the installer grows with it, so it is a real trade rather than free.

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
npm run test       run the feature files against a real browser
npm run dev        same app in a browser tab, Chrome or Edge only
```

`npm test` needs its browser once, with `npx playwright install chromium`. It
drives Chrome with a fake microphone, so it can check that the bars actually
move rather than only that they exist. Animation is the part that cannot be
tested by reading the page: a window that is never drawn never runs an
animation frame, so those tests need a real browser to mean anything.

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
  meter.ts        the live bars, reading the recorder's own microphone stream
  audio.ts        webm into mono 16 kHz samples, what Whisper wants
  transcriber.ts  talks to the worker, queues jobs
  worker.ts       Whisper itself, off the main thread
  store.ts        remembers your folder and your language
scripts/
  setup.mjs       the one network moment
  icon.mjs        renders the app icon
  package.mjs     builds the installer and puts it where you can find it
features/
  *.feature       what each feature is supposed to do, in plain English
tests/
  *.spec.ts       the same scenarios, executed
```

The meter watches the stream the recorder already opened rather than asking for
the microphone a second time. A second request would prompt macOS all over
again and hold a second device open for nothing.

Browser storage holds exactly two things: the handle for your folder, and which
transcription language you picked. Folder handles cannot go into localStorage,
which is why there is a database at all; the language rides along in the same
place rather than inventing a second way to remember things. Nothing about your
recordings is kept in the app.

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
