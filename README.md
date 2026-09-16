# Blab

Record a talk. Type your notes while it runs. Press stop and it writes the
transcript on your own computer.

No account. No login. No cloud. No API key. No subscription. Nothing leaves
your machine.

Windows, Mac and Linux. Free. Open source. Offline.

## Download

Everything is on the [releases page](https://github.com/jurecerkez-code/Blab/releases/latest).

| Your computer | File | What to do |
|---------------|------|------------|
| **Windows** | `Blab-Setup-*.exe` | Run it. One warning screen. Click More info, Run anyway. |
| **Mac** | `Blab-*.dmg` | Open it, drag Blab into Applications. One warning screen. See below. |
| **Linux** | `Blab-*.AppImage` | `chmod +x Blab-*.AppImage && ./Blab-*.AppImage --no-sandbox` |

One Mac file works on every Mac, old or new. The Linux file installs nothing.

**Mac warning screen:** Done, then System Settings, Privacy & Security, scroll
down, Open Anyway. **Why the warning exists:** Blab is unsigned, because
signing costs 99 dollars a year and Blab is free. This is the price.

**Linux:** AppImages on Ubuntu 22 and older need `sudo apt install libfuse2`.
The `--no-sandbox` flag is a Chromium thing, not a Blab bug.

### Or one command

Same command on all three systems, only the shell differs.

**Mac and Linux**

```
curl -fsSL https://raw.githubusercontent.com/jurecerkez-code/Blab/main/scripts/install.sh | sh
```

**Windows**, in PowerShell

```
irm https://raw.githubusercontent.com/jurecerkez-code/Blab/main/scripts/install.ps1 | iex
```

Neither asks for an administrator password. Both scripts are short, read them
before you run them.

## How it works

1. Open Blab. Pick a folder. This is the only choice you ever make.
2. Type a title. Press Record.
3. Type your notes while the talk runs.
4. Press Stop. The transcript appears next to your notes.

Every recording is three plain files in the folder you picked:
`audio.webm`, `notes.md`, `transcript.md`. No database. Open them in any
editor, move them anywhere.

The notes and the transcript both carry times. Click a line, the audio plays
from that moment.

Three speech models (Fast, Balanced, Best) are inside the installer. Blab
picks one for your machine on first launch: Best on Apple Silicon, Balanced
on a modern laptop, Fast on an old one. You can change it in the app. That is
all the configuration there is.

Done installing means done. Nothing to download later, works offline forever,
even if this repository disappears tomorrow.

## What it does not do

- No account. No login. No onboarding flow.
- No cloud. It cannot reach the internet at all. That is not a promise in a
  README, it is a rule the app runs under that blocks every outgoing
  connection. The source is public, go and try to break it.
- No subscription. Nothing to renew. No upgrade to Pro.
- No auto-update. Download once, it works forever.
- No telemetry. No analytics. No "AI companion".

## If your recording goes wrong

| What you see | What it means |
|--------------|---------------|
| The bars stay flat while you talk | Blab cannot hear you. Wrong microphone, muted, unplugged. Fix it now, not after the talk. |
| The transcript repeats one phrase forever | Whisper got stuck, because the microphone was too far away. Say it with the mic closer. |
| Saved, but Blab says the transcript looks like a loop | Same thing. It says so instead of pretending. That is the feature. |

## Why the download is big

All three speech models are inside the installer (about 758 MB). That is
what makes "nothing to download later" true.

## Build it yourself

```
git clone https://github.com/jurecerkez-code/Blab.git
cd Blab
npm install
npm run setup        # downloads the models once, needs internet
npm run dev          # the app in a browser tab
npm run app          # the desktop app
npm run app:check    # mic, model and worker, all four lines must say ok
npm run package      # installer for your OS
```

## Rejected, with reasons

Two suggestions keep coming up. Both were measured and turned down, and the
reasons are written into the code so nobody asks twice.

- **Beam search.** The bundled Whisper engine has no beam search at all.
  Verified against its source. The flag does nothing.
- **WebGPU.** It needs fp32 weights, which triple the download, for no gain
  at the sizes Blab ships.

## Licence

MIT. What changed in each version lives on the
[releases page](https://github.com/jurecerkez-code/Blab/releases).
