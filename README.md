# Blab

Record a talk. Type your notes while it runs. Press stop and it writes the
transcript on your own computer.

No account. No login. No cloud. No API key. No subscription. Nothing leaves
your machine.

Windows, Mac and Linux. Free. Offline. Your words stay on your machine.

## Download

Everything is on the [releases page](https://github.com/jurecerkez-code/Blab/releases/latest).

| Your computer | File | What to do |
|---------------|------|------------|
| **Windows** | `Blab-Setup-*.exe` | Run it. You get [a warning](#the-warning-on-windows-and-mac). That is expected |
| **Mac** | `Blab-*.dmg` | Open it, drag Blab into Applications. You get [a warning](#the-warning-on-windows-and-mac). That is expected |
| **Linux** | `Blab-*.AppImage` | `chmod +x Blab-*.AppImage && ./Blab-*.AppImage --no-sandbox` |

One Mac file works on every Mac, old or new. You do not need to know which
chip is in yours. The Linux file installs nothing and needs no package manager.

### Or one command

Same command on all three systems, only the shell differs. It finds the latest
release, downloads the one file for your machine, and puts it where that
system expects an app to live.

**Mac and Linux**

```
curl -fsSL https://raw.githubusercontent.com/jurecerkez-code/Blab/main/scripts/install.sh | sh
```

**Windows**, in PowerShell

```
irm https://raw.githubusercontent.com/jurecerkez-code/Blab/main/scripts/install.ps1 | iex
```

Mac lands in Applications. Linux gets `blab` on your path and an entry in
your menu. Windows runs the normal installer and Blab turns up in the Start
menu. None of them asks for an administrator password.

Both scripts are short and live in `scripts/`. Reading one before piping it
into a shell is a reasonable thing to do.

## Using it

1. Open Blab and pick a folder for your recordings. Once, ever.
2. Type a title. Press **Record**.
3. Type notes while you listen. Blab remembers when each line was written.
4. Press **Stop**. Your audio and notes are saved, and Blab transcribes on
   this machine, in the background.
5. Open the recording to read the transcript, click any line to hear that
   moment, or press the speed button to review faster.

All three Whisper models (Fast, Balanced, Best) are inside the installer.
Blab picks the right one for your machine on first launch: Best on Apple
Silicon, Balanced on a modern laptop, Fast on an older one. The picker in the
app is only there if you want to override it.

The rest is optional extras, each one checkbox-sized:

- **Live captions** while you record, so a dead microphone is obvious during
  the talk, not after it.
- **Record computer audio too**: the other side of a call lands in the file
  as well as your voice.
- **Import audio**: transcribe an mp3, m4a, wav, ogg, flac, opus, aac or webm
  that was not recorded in Blab.
- **Re-transcribe** any recording with a different model, no re-recording.
- **Save .srt / .vtt** subtitles or a plain `.md` / `.txt` copy of the talk.
- **Space, arrow keys, 0.5x to 2x speed** on the built-in player.

### Troubleshooting

| What you see | What to do |
|--------------|------------|
| **Windows:** "Windows protected your PC" | **More info** then **Run anyway**. [Why](#the-warning-on-windows-and-mac) |
| **Mac:** "Blab" Not Opened, no Open button | **Done**, then System Settings, Privacy & Security, scroll down, **Open Anyway**. [Why](#the-warning-on-windows-and-mac) |
| **Linux:** `dlopen(): error loading libfuse.so.2` | `sudo apt install libfuse2`, or run `APPIMAGE_EXTRACT_AND_RUN=1 ./Blab-*.AppImage --no-sandbox` |
| **Linux:** refuses to start from a terminal | Add `--no-sandbox` |
| The bars stay flat while you talk | Blab cannot hear you. Wrong microphone, muted, or unplugged. Fix it now, not after the talk |
| The transcript repeats one phrase forever | Whisper got stuck, because the microphone was too far away |

## Where your stuff goes

A recording is a folder named `2026-09-15_1430_talk-title` in the folder you
picked. Inside: `audio.webm`, `notes.md`, `transcript.md`. Plain files, no
database, readable in any editor, movable anywhere. Your notes and the
transcript both carry `[mm:ss]` stamps so the two sit on one timeline.

Blab will not record into a git repository. It refuses such folders outright:
recordings in a working tree are one `git add -A` from being pushed somewhere
they do not belong.

Do not create folders inside your recordings folder by hand. Blab names them
and ignores anything it did not name.

A fresh install ships with no recordings. You point it at a folder and it
starts there.

## Worth going back to

Above every transcript is a short list: the lines the talk kept coming back
to, and the moments where you were typing. Every line is quoted whole from
the transcript, with the time it was said. Nothing here is written by a
machine. A wrong pick costs you a dull line, never an invented fact.

## What it writes, and how well

Transcription runs faster than real time on the Fast model (about 3.5x on a
laptop CPU: a 45 minute talk takes around 13 minutes, in the background).
Balanced and Best trade speed for accuracy; Best is worth the wait on Apple
Silicon, and slow on an old CPU. There is no length limit: a long recording
is decoded in blocks, memory is the only ceiling.

Silence never reaches Whisper. A small voice-activity detector (Silero, also
on your machine) finds the actual speech, so a quiet room does not turn into
a hallucinated loop, and the transcript is faster for it. Whisper itself is
guarded against repetition, and each 30 second pass is capped at 224 tokens
so a stuck model cannot run on forever.

### When the room beats the microphone

Whisper is honest about its limits. If the transcript looks like a loop, the
app says so in plain words instead of pretending: get the microphone closer
and record again. A laptop mic at the back of a lecture hall will never read
like a studio recording, and no app setting changes that.

## Does it phone home

No. The app's security policy blocks every network connection at the engine
level, and there is no telemetry code to run if it could. The only download
in your life with Blab is Blab itself. A source build downloads the models
once during setup and never needs the network again.

## Why the file is so big

Because everything is already in it. All three Whisper models plus the
voice-activity detector ship inside the installer (about 758 MB), which is
why the answer to "do I need to download anything else" is no. The trade is
a bigger download once for never needing the network forever.

## Building it yourself

```
git clone https://github.com/jurecerkez-code/Blab.git
cd Blab
npm install
npm run setup        # one-time model download, needs internet
npm run dev          # the app in a browser tab
npm run app          # the desktop app
npm run app:check    # proves mic, model and worker end to end
npm run package      # installers for your OS
```

## How it is built

Electron + TypeScript + Vite. Whisper runs inside the app through
transformers.js (WebAssembly, no Python, no GPU driver required), the VAD
runs through the same vendored onnxruntime, and storage is plain files in a
folder you own. The README you are reading goes with a repo where every
safety rule (offline, no accounts, plain files) is enforced in code, not
promised in prose.

## Rejected, with reasons

Decisions are kept in the code where reviewers can see them. Two frequent
suggestions were measured and turned down:

- **Beam search** (better accuracy in some engines). The bundled
  transcription engine has no beam search at all; the results were
  byte-identical with the flag on. Verified against the engine source, with
  the comment left in `src/worker.ts`.
- **WebGPU acceleration** (how the browser demos are fast). WebGPU needs
  fp32 weights, which triple the model download for no gain at Blab's sizes.
  Wasm with all threads is the ceiling this app is built for.

The same logic keeps summaries out: Blab quotes what was said, and a small
local model writing smooth paragraphs would invent decisions nobody took.

## Contributing

Fork it, change it, send a pull request. The repo runs the full test suite in CI on every push and pull
request; keep it green. Feature ideas fit the project when they
do not need a server, a login, or a bill.

## Licence

MIT. See [LICENSE](LICENSE). What changed in each version lives on the
[releases page](https://github.com/jurecerkez-code/Blab/releases).

---

*The two sections below exist so the table up top can be short. Read them
once, and forward them to anyone who asks "is this safe to run".*

## The warning on Windows and Mac

Blab is free, so it is unsigned: Apple wants 99 dollars a year to not show a
warning, and Microsoft asks for a certificate that costs the same. Blab
cannot pay that without charging you, so you click through once. Nothing is
switched off or weakened to manage it. The install scripts skip the warning
on Mac, because a file a browser downloaded is marked differently from one
`curl` fetched.

## The two Linux quirks

AppImages on Ubuntu 22 and older need `libfuse2` (`sudo apt install
libfuse2`), and Chromium (the engine inside Electron) refuses to run as root,
which is why the sandbox flag appears in the Linux commands. Neither is a
Blab bug; both are how AppImage and Chromium behave for every app.
