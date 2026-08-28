# Blab

Record a talk. Type your notes while it runs. Press stop and it writes the
transcript on your own computer.

No account. No login. No cloud. No API key. No subscription. Nothing leaves
your machine.

Windows, Mac and Linux. Free. One feature.

## Download

| Your computer | File | What to do |
|---------------|------|------------|
| **Windows PC** | `Blab-Setup-*.exe` | Run it. Windows shows a warning. Click **More info**, then **Run anyway** |
| **Mac** | `Blab-*.dmg` | Open it, drag Blab into Applications. First time only: double click Blab, click **Done**, then go to **System Settings → Privacy & Security** and click **Open Anyway** |
| **Linux** | `Blab-*.AppImage` | Right click it, Properties, tick **Allow executing file as program**. Then double click. Or `chmod +x Blab-*.AppImage && ./Blab-*.AppImage` |

All three from the [releases page](https://github.com/jurecerkez-code/Blab/releases/latest).
One file for every Mac, old or new. You do not need to know which chip is in
your computer. The Linux file installs nothing and needs no package manager —
it is one executable you can keep wherever you like.

### Or from a terminal

One command, and the same command on all three systems in everything but the
name of the shell. It finds the latest release, downloads the one file for the
machine you are on, and puts it where that system expects an app to live.

**Mac and Linux**

```
curl -fsSL https://raw.githubusercontent.com/jurecerkez-code/Blab/main/scripts/install.sh | sh
```

**Windows**, in PowerShell

```
irm https://raw.githubusercontent.com/jurecerkez-code/Blab/main/scripts/install.ps1 | iex
```

On a Mac the app lands in Applications. On Linux you get `blab` on your path
and an entry in your menu. On Windows the normal installer runs and Blab turns
up in the Start menu. None of them asks for an administrator password, because
Blab installs for one user and needs nothing from the system.

The Mac route has one accidental advantage. That "Apple could not verify this
app" screen is shown for files a **browser** downloaded, and `curl` does not
mark them the same way, so it never appears. Nothing is switched off to manage
that — the app is exactly as unsigned as it ever was, you simply never meet the
gate. If that bothers you, use the dmg from the table above and click through
it instead.

Both scripts are short, they live in `scripts/` in this repository, and reading
one before piping it into a shell is a reasonable thing to want to do.

### About that warning

Nothing is wrong with the file. Windows and Mac both shout at any app whose
author has not paid them a yearly fee. Apple wants 99 dollars a year, Microsoft
wants a few hundred euros.

Blab makes no money, so it pays nobody, so you get one warning screen on the
way in.

Linux asks for none of this. An AppImage only needs to be marked executable,
which is the same click any downloaded program gets.

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

The speech model is inside it. 153 MB on Windows, 187 MB on Linux, 276 MB on
Mac. The Mac one is bigger because it holds a version for both Apple and Intel
chips in one file.

Once it is installed, Blab downloads nothing, ever. The first launch takes
about ten seconds while the model loads. Every launch after that is two or
three.

The Linux build starts with Chromium's own sandbox switched off. That is
electron-builder's default for an AppImage rather than a choice made here, and
it has a reason: the sandbox needs a small root-owned helper, an AppImage is a
single unprivileged file and cannot ship one. The generated menu entry passes
`--no-sandbox` for you.

Run the file straight from a terminal and it gets no such flag, so on Ubuntu
24.04, and any distribution that restricts unprivileged user namespaces, it
will refuse to start. Pass the flag yourself and it opens:

```
./Blab-*.AppImage --no-sandbox
```

None of that touches what keeps Blab to itself. The window still has no Node
access, and `connect-src 'self'` still forbids the network, on Linux exactly
as on the other two.

There is one more Linux thing, and it is not Blab's doing either. An AppImage
is a small filesystem the runtime mounts, which needs FUSE, and Ubuntu has not
shipped `libfuse2` since 22.04. On a stock install, double clicking the file
gets you `dlopen(): error loading libfuse.so.2` and nothing else. Either
install it:

```
sudo apt install libfuse2
```

or tell the runtime to unpack itself instead, which needs nothing:

```
APPIMAGE_EXTRACT_AND_RUN=1 ./Blab-*.AppImage --no-sandbox
```

The terminal installer further up already handles both — it checks for the
library once and writes whichever launcher is right for your machine — which
is the main reason to prefer it on Linux.

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

Two things look after a recording while it runs. Closing the window, quitting
and reloading all ask first, rather than throwing away a talk that is not on
disk yet — nothing is written until Stop, so on a Mac a habitual Cmd+W or Cmd+R
used to cost the lot. And the machine is asked to stay awake, so a lecture does not end early
because a laptop decided it was idle. The screen may still go dark; only sleep
is held off.

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
Paste it into an AI, an email, or wherever it needs to go. **Save .md** and
**Save .txt** write the same block as a file, wherever you point them, for the
times someone wants an attachment rather than a paste.

Every line in there says when it happened, and clicking one plays the audio
from that second. That works for the transcript and for your own notes, which
is the useful half: you wrote "ask him about the deadline" at fourteen minutes,
so click it and hear what was actually said at fourteen minutes.

## Where your stuff goes

```
your-folder/
  2026-06-14_1030_judge-talk/
    audio.webm
    notes.md
    transcript.md
```

Plain files. No database, no index, no hidden state.

Both text files carry the time each line belongs to, counted from the start of
the recording:

```
[00:00] Right, we should probably get started.
[00:31] The first thing is the database migration.
```

That is still plain text. `grep` finds it, any editor opens it, and the times
are the same numbers in both files — a note at `[14:20]` and a transcript line
at `[14:20]` are the same moment of audio. They line up even when the talk had
a break in it, because a pause writes nothing: recorded time and position in
`audio.webm` never drift apart.

Your notes are split where you stopped typing. Write a bit, listen, write a bit
more, and each time you come back is a new line with its own time — you do not
have to press Enter, and a paragraph you never broke up is not one moment.
Pressing Enter splits it too, immediately, because that is you saying where a
thought ended.

Notes typed before you press Record have no time to carry and get no prefix.
Recordings made by an older Blab have none either, and open exactly as they
always did.

Open them in any editor. Search them with anything. Back them up by copying the
folder. Blab does not need to be running. Blab does not need to exist.

The folder name is `date_time_title`, so titles come back as slugs. "API
Workshop" shows up as "Api workshop" in the list. The files are what matter.
That is the price of not keeping a separate index.

## Worth going back to

Above the transcript there is a short list of lines from the talk. Not a
summary — a shortlist. Every line in it was said out loud and is quoted whole,
with the time it was said at, so you can click one and hear it.

It is not written by a model, and that is a choice rather than a shortcut. A
small language model small enough to ship inside this installer would write
smoother paragraphs and would also, on exactly the transcripts that are already
hard to trust, state decisions nobody took. The transcript further up this file
that repeated one phrase 434 times is the input a summariser would have been
handed. A wrong pick here costs you one dull line, and you can see the time
beside it and go check.

Two things decide the shortlist. The first is what the talk keeps coming back
to — a word said forty times is the subject, a word said once is an aside. The
second is where you were typing. A note written at fourteen minutes says the
speaker was worth writing down at fourteen minutes, and no statistic beats
someone who was in the room, so lines near your notes are pulled up the list.

Recordings under a couple of minutes get nothing. There is no shape in them to
find, and three padded lines would only look like there was.

If you want real minutes, press **Copy all** and paste it into a large model.
Everything it needs, including the full transcript and your notes with their
times, is in that one block. That stays the honest division of labour: Blab
does the part that has to happen on your machine, and does not pretend a 0.6
billion parameter model is the same thing as a good one.

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
- The window has no Node access, and runs sandboxed on Windows and Mac. The
  Linux AppImage cannot, for the reason given further up; nothing else about
  it changes.
- USB, HID and serial devices are refused outright.
- Three permissions are granted. Microphone, the folder you picked, clipboard.
- Two things here download anything, and neither is the app. `npm run setup`
  fetches the model once while you build; `scripts/install.sh` and its
  PowerShell twin fetch one release file if you choose to install that way.
  All three are short and you can read all of them.

Your audio, your notes and your transcripts stay in your folder.

## Building it yourself

You need [Node.js](https://nodejs.org) 20 or newer, and you can only build for
the system you are sitting at. Windows makes the exe, a Mac makes the dmg, a
Linux machine makes the AppImage.

```
git clone https://github.com/jurecerkez-code/Blab.git
cd Blab
npm install
npm run setup
npm run package
```

That writes the installer for whatever machine you ran it on into the folder.

Needing two computers to cut one release is how 0.3.2 went out as an exe with
no dmg beside it, leaving everyone on a Mac a version behind. So pushing a tag
now builds all three:

```
git tag v0.5.0
git push origin v0.5.0
```

GitHub lends out a Windows machine, a Mac and a Linux box, runs the same
`npm run package` on each, and leaves all three installers on a **draft**
release. Nothing is public until someone reads it and presses publish.
`.github/workflows/release.yml` is the whole of it, and you can run it by hand
from the Actions tab to check the build still works without tagging anything.

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

The times, the note clock and the shortlist are text in and text out, so their
tests are plain functions with no page at all. The one that matters is scored
against a meeting the length Whisper actually cuts one into. A handful of tidy
sentences would prove nothing: telling the subject of a talk from the chat
around it is the whole job, and it only becomes visible over enough lines.

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
  store.ts        remembers your folder and your language
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
