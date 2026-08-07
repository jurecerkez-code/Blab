// Thin wrapper over MediaRecorder. Holds the mic open for one recording only.
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm'];

function pickMime(): string | undefined {
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
}

export class Recorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];

  get active(): boolean {
    return this.recorder !== null;
  }

  get paused(): boolean {
    return this.recorder?.state === 'paused';
  }

  /** The live stream, so a meter can watch it without opening the mic again. */
  get mediaStream(): MediaStream | null {
    return this.stream;
  }

  /** Throws if the browser or the user refuses the mic. */
  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    const mimeType = pickMime();
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start();
  }

  /**
   * Stops writing without ending the recording. The microphone stays open and
   * the file stays one file — resume() carries on into the same one, so a
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
    this.release();
    return blob;
  }

  private release(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
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
