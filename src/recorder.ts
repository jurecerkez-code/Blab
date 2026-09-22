// Thin wrapper over MediaRecorder. Holds the mic open for one recording only,
// and; when asked; a second capture of whatever the computer is playing so
// the other side of a call is in the file too.
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm'];

function pickMime(): string | undefined {
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
}

export type RecorderOptions = {
  /** Also record what the computer is playing (meeting capture). */
  captureSystem?: boolean;
  /** Called with a plain-language notice when system capture degrades. */
  onSystemWarning?: (message: string) => void;
};

/** Peak amplitude (0-1) of whatever source it is attached to, sampled coarsely. */
class LevelProbe {
  private analyser: AnalyserNode | null = null;
  private data = new Uint8Array(0);
  private peakValue = 0;
  private timer: number | undefined;

  attach(ctx: AudioContext, source: AudioNode): void {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
    this.data = new Uint8Array(this.analyser.frequencyBinCount);
    source.connect(this.analyser);
    const sample = () => {
      if (!this.analyser) return;
      this.analyser.getByteTimeDomainData(this.data);
      let p = 0;
      for (let i = 0; i < this.data.length; i++) {
        const v = (this.data[i] - 128) / 128;
        if (v * v > p) p = v * v;
      }
      this.peakValue = Math.max(this.peakValue, Math.sqrt(p));
      this.timer = window.setTimeout(sample, 500);
    };
    sample();
  }

  detach(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.timer = undefined;
    this.analyser?.disconnect();
    this.analyser = null;
  }

  get peak(): number {
    return this.peakValue;
  }
}

export class Recorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private system: MediaStream | null = null;
  private chunks: Blob[] = [];
  private mix: { ctx: AudioContext; dest: MediaStreamAudioDestinationNode } | null = null;
  private systemProbe = new LevelProbe();
  /** Human-scale notice for whatever went sideways; read after stop(). */
  warnings: string[] = [];
  /** True when system audio was wanted but the machine stayed silent. */
  gotQuietSystem = false;

  get active(): boolean {
    return this.recorder !== null;
  }

  get paused(): boolean {
    return this.recorder?.state === 'paused';
  }

  /** The live mic stream, so a meter can watch it without opening the mic again. */
  get mediaStream(): MediaStream | null {
    return this.stream;
  }

  /**
   * Throws if the browser or the user refuses the mic. A system-capture
   * failure never throws; the recording carries on on the mic alone, with a
   * warning the caller can pass on.
   */
  async start({ captureSystem = false, onSystemWarning }: RecorderOptions = {}): Promise<void> {
    this.warnings = [];
    this.gotQuietSystem = false;
    this.stream = await navigator.mediaDevices.getUserMedia({
      // `audio: true` would take Chromium's defaults, and its defaults are
      // tuned for a voice call: keep a human on the other end comfortable,
      // throw away everything else. Whisper is not a human on the other end.
      //
      // Noise suppression is the one that hurts. It works by gating short
      // broadband transients, and the release of a /d/ or a /t/ *is* a short
      // broadband transient; so it files the front off consonants. "Rear delt"
      // came back as "rear aelt" here, and Whisper only invents a non-word when
      // the sound it was given has genuinely lost something.
      //
      // Automatic gain is the one the README already complains about: it lifts a
      // quiet room until the meter looks healthy while mostly amplifying the air
      // conditioning. Echo cancellation is looking for a far-end signal that
      // does not exist when nobody is on a call.
      //
      // Whisper was trained on audio off the open web, which has had none of
      // this done to it. Hand it the microphone as it comes.
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        // Whisper works in mono and everything downstream mixes to it anyway.
        // Asking here means one channel is recorded rather than two thrown away.
        channelCount: 1,
      },
    });
    this.chunks = [];

    const ctx = new AudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    const dest = ctx.createMediaStreamDestination();
    const micSource = ctx.createMediaStreamSource(this.stream);
    micSource.connect(dest);

    if (captureSystem) {
      try {
        const got = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        // The video half was only asked for because getDisplayMedia insists;
        // the audio track is the point of meeting capture.
        got.getVideoTracks().forEach((t) => t.stop());
        this.system = new MediaStream(got.getAudioTracks());
        const sysSource = ctx.createMediaStreamSource(this.system);
        sysSource.connect(dest);
        this.systemProbe.attach(ctx, sysSource);
      } catch (err) {
        this.system = null;
        onSystemWarning?.(
          `Could not capture computer audio (${(err as Error).message}); recording the microphone only.`,
        );
      }
    }

    this.mix = { ctx, dest };
    const mimeType = pickMime();
    this.recorder = new MediaRecorder(dest.stream, mimeType ? { mimeType } : undefined);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
  }

  /**
   * Stops writing without ending the recording. The microphone stays open and
   * the file stays one file; resume() carries on into the same one, so a
   * lecture with a break in the middle does not become two recordings.
   *
   * The pause itself is not stored: nothing is written while paused, so a ten
   * minute break costs no disk and no transcription time.
   */
  pause(): void {
    if (this.recorder?.state === 'recording') this.recorder.pause();
  }

  resume(): void {
    if (this.recorder?.state === 'paused') this.recorder.resume();
  }

  async stop(): Promise<Blob> {
    const recorder = this.recorder;
    if (!recorder) throw new Error('Not recording.');
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }));
      recorder.stop();
    });
    this.gotQuietSystem = Boolean(this.system) && this.systemProbe.peak < 0.02;
    if (this.gotQuietSystem) {
      this.warnings.push(
        'No computer audio was heard, so this recording is the microphone alone. On Windows, check that no other app has the loopback device; in a browser tab, the share dialog needs "Share tab audio" ticked.',
      );
    }
    this.release();
    return blob;
  }

  private release(): void {
    this.systemProbe.detach();
    // The mixer keeps the audio device open after the recorder stops, so it
    // gets closed first: Chromium sees the tracks end and releases the device.
    this.mix?.ctx.close().catch(() => {});
    this.mix = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.system?.getTracks().forEach((t) => t.stop());
    this.system = null;
    this.recorder = null;
    this.chunks = [];
  }
}

export function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
