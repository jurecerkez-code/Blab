// A row of bars that moves with the microphone, so a dead mic is obvious while
// recording rather than after it. Watches the stream the recorder already
// opened — a second getUserMedia would ask macOS for the microphone all over
// again, and hold a second capture open for no reason.
const BARS = 14;
/** Speech lives here; the rumble below and the hiss above only add noise. */
const MIN_HZ = 60;
const MAX_HZ = 6000;
/** How far a bar falls per frame once the sound stops. */
const DECAY = 0.06;
/** A little height at rest, so the row still reads as a meter when silent. */
const FLOOR = 0.06;

/**
 * Bin boundaries for each bar, spaced logarithmically because hearing is.
 * Worked out from the real sample rate rather than a fixed bin count: Windows
 * usually opens the microphone at 48 kHz and macOS at 44.1 kHz, so the same
 * bin means a different frequency on each.
 */
function bandEdges(sampleRate: number, fftSize: number): number[] {
  const perBin = sampleRate / fftSize;
  const top = Math.min(MAX_HZ, sampleRate / 2);
  const last = fftSize / 2 - 1;
  return Array.from({ length: BARS + 1 }, (_, i) => {
    const hz = MIN_HZ * (top / MIN_HZ) ** (i / BARS);
    return Math.min(Math.round(hz / perBin), last);
  });
}

export class Meter {
  private readonly bars: HTMLElement[];
  private readonly levels: number[] = new Array<number>(BARS).fill(0);
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private spectrum = new Uint8Array(0);
  private edges: number[] = [];
  private frame: number | undefined;

  constructor(private readonly host: HTMLElement) {
    this.bars = Array.from({ length: BARS }, () => {
      const bar = document.createElement('span');
      bar.className = 'bar';
      host.append(bar);
      return bar;
    });
  }

  /** Never throws: a missing meter is not a reason to lose a recording. */
  async start(stream: MediaStream): Promise<void> {
    this.stop();
    try {
      const ctx = new AudioContext();
      // A context can be born suspended — Chrome does it outside a gesture, and
      // Windows does it again when the audio device was asleep.
      if (ctx.state === 'suspended') await ctx.resume();

      const analyser = ctx.createAnalyser();
      // 2048 rather than something smaller: at 48 kHz a 512-point FFT has bins
      // 94 Hz apart, which is wider than the lowest few bars, so they end up
      // reading the same bin and moving as one. This is fine to do every frame.
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.6;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      // Deliberately not connected to ctx.destination: that would play the
      // microphone back through the speakers and howl.

      this.ctx = ctx;
      this.source = source;
      this.analyser = analyser;
      this.spectrum = new Uint8Array(analyser.frequencyBinCount);
      this.edges = bandEdges(ctx.sampleRate, analyser.fftSize);
      this.host.classList.add('live');
      this.frame = requestAnimationFrame(this.draw);
    } catch {
      this.stop();
    }
  }

  stop(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.source?.disconnect();
    this.analyser?.disconnect();
    // Closing matters more than it looks. Dropping the references alone leaves
    // the audio device open, and both Windows and macOS then keep showing Blab
    // as using the microphone long after Stop.
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.source = null;
    this.analyser = null;
    this.host.classList.remove('live');
    this.levels.fill(0);
    for (const bar of this.bars) bar.style.transform = '';
  }

  private readonly draw = (): void => {
    const analyser = this.analyser;
    if (!analyser) return;
    analyser.getByteFrequencyData(this.spectrum);

    for (let i = 0; i < BARS; i++) {
      const from = this.edges[i];
      const to = Math.max(this.edges[i + 1], from + 1);
      let peak = 0;
      for (let bin = from; bin < to; bin++) peak = Math.max(peak, this.spectrum[bin]);

      // Rise at once so a clap lands on the frame it happened, fall gently so
      // the row reads as a level rather than a flicker.
      this.levels[i] = Math.max(peak / 255, this.levels[i] - DECAY);
      // scaleY rather than height: the browser can do it without laying the
      // page out again, sixty times a second.
      this.bars[i].style.transform = `scaleY(${(FLOOR + this.levels[i] * (1 - FLOOR)).toFixed(3)})`;
    }
    this.frame = requestAnimationFrame(this.draw);
  };
}
