// Live captions: what Whisper hears, shown while the talk is still happening.
//
// The recording itself is captured by MediaRecorder; this module steals a
// second copy of the mic stream, resamples it to the 16 kHz Whisper wants,
// keeps a rolling window, and feeds short windows to the transcription worker
// whenever it is idle. They are previews, not the transcript: at Stop the
// whole file is transcribed properly, and the captions are replaced.
//
// Silence is skipped before anything reaches the worker — transcribing a
// pause is how Whisper learns to hallucinate, and it burns the same CPU.

const WINDOW_MS = 15_000;
const EVERY_MS = 6000;
/** RMS below this is treated as silence and never sent to Whisper. */
const RMS_FLOOR = 0.008;
const TARGET_RATE = 16000;

function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Linear resampler, reset before each window (captions are previews). */
class Resampler {
  private last = 0;
  private pos = 0;
  constructor(
    private readonly ratio: number, // input rate / output rate
  ) {}

  reset(firstSample: number): void {
    this.last = firstSample;
    this.pos = 0;
  }

  /** Pushes input; appends resampled samples into `out`, returns count written. */
  push(input: Float32Array, out: Float32Array): number {
    let written = 0;
    let pos = this.pos;
    while (written < out.length) {
      const i0 = Math.floor(pos);
      if (i0 >= input.length - 1) break;
      const frac = pos - i0;
      const a = i0 >= 0 ? input[i0] : this.last;
      const b = input[i0 + 1];
      out[written++] = a + (b - a) * frac;
      pos += this.ratio;
    }
    this.last = input[input.length - 1];
    this.pos = pos - input.length;
    return written;
  }
}

export class LiveCaptions {
  private host: HTMLElement;
  private line: HTMLButtonElement | null = null;
  private ctx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private ring: Float32Array = new Float32Array(0);
  private sampleRate = 48000;
  private timer: number | undefined;
  /** Last time a window went to Whisper — never more often than once a second. */
  private lastSentAt = 0;
  private readonly send: (audio: Float32Array, at: number) => void;

  constructor(
    host: HTMLElement,
    onWindow: (audio: Float32Array, at: number) => void,
  ) {
    this.host = host;
    this.send = onWindow;
  }

  /** Adds one caption line. */
  show(text: string, at: number, fmt: (ms: number) => string): void {
    if (!this.line) {
      this.line = document.createElement('button');
      this.line.className = 'caption';
      this.line.type = 'button';
      this.line.title = 'Live preview — the saved transcript may differ.';
      this.line.disabled = true;
      this.host.append(this.line);
    }
    const stamp = document.createElement('span');
    stamp.className = 'at';
    stamp.textContent = fmt(Math.max(0, at));
    this.line.replaceChildren(stamp, document.createTextNode(' '), document.createTextNode(text));
  }

  clear(): void {
    if (this.line) {
      this.line.remove();
      this.line = null;
    }
  }

  /**
   * Starts watching a stream. `now` must return the recording position in ms
   * (the same clock the transcript uses), and `fmt` renders times.
   */
  async start(stream: MediaStream, now: () => number): Promise<void> {
    this.stop();
    try {
      const ctx = new AudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      this.sampleRate = ctx.sampleRate || 48000;
      const source = ctx.createMediaStreamSource(stream);
      // ScriptProcessor rather than AudioWorklet: the worklet module would be
      // a blob:, and the CSP deliberately does not allow blob: scripts.
      const node = ctx.createScriptProcessor(4096, 1, 1);

      node.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        this.ring = grow(this.ring, input.length);
        this.ring.set(input, this.ring.length - input.length);
      };

      // ScriptProcessor needs an output; route it into a muted gain so
      // nothing audible comes back down the wire.
      const muted = ctx.createGain();
      muted.gain.value = 0;
      source.connect(node);
      node.connect(muted);
      muted.connect(ctx.destination);

      this.ctx = ctx;
      this.processor = node;
      this.timer = window.setInterval(() => {
        void this.consider(now());
      }, EVERY_MS);
    } catch {
      // Captions are a preview. A machine that cannot run them still records.
      this.stop();
    }
  }

  /** Decides whether the latest window deserves Whisper's attention. */
  private consider(now: number): void {
    if (Date.now() - this.lastSentAt < 1500) return;
    const ring = this.ring;
    if (ring.length < this.sampleRate * 2) return;
    const windowLen = Math.floor((this.sampleRate * WINDOW_MS) / 1000);
    const from = Math.max(0, ring.length - windowLen);
    const window = ring.slice(from);
    if (rms(window) < RMS_FLOOR) return;

    const resampler = new Resampler(this.sampleRate / TARGET_RATE);
    resampler.reset(window[0] ?? 0);
    const out = new Float32Array(Math.ceil(window.length * (TARGET_RATE / this.sampleRate)) + 8);
    const used = resampler.push(window, out);

    this.lastSentAt = Date.now();
    const at = Math.max(0, now - WINDOW_MS);
    this.send(out.slice(0, used), at);
  }

  stop(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
    this.timer = undefined;
    try {
      this.processor?.disconnect();
      this.processor = null;
    } catch {
      /* already gone */
    }
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.ring = new Float32Array(0);
  }
}

/** Appends to the ring, dropping the oldest samples past the cap. */
function grow(ring: Float32Array, by: number): Float32Array {
  // The ring lives at the microphone rate (usually 48 kHz), so 45 s is
  // 2.16 M samples - comfortably over the 15 s caption window.
  const cap = 2_160_000;
  const keepLen = Math.min(ring.length, Math.max(0, cap - by));
  const next = new Float32Array(keepLen + by);
  next.set(ring.subarray(ring.length - keepLen), 0);
  return next;
}
