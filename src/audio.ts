/** Whisper wants mono PCM at 16 kHz. Anything else and it hears nonsense. */
export const SAMPLE_RATE = 16000;

/** Opus always decodes at 48 kHz, whatever we ask for afterwards. */
const OPUS_RATE = 48000;

/**
 * How much 48 kHz audio to hold before resampling it down and letting it go.
 * Ten minutes is 28.8 M samples, about 115 MB — large enough that the seams
 * between blocks are rare, small enough to never approach the allocation
 * ceiling that broke the whole-file path.
 */
const BLOCK_FRAMES = OPUS_RATE * 60 * 10;

/**
 * Decodes a recording into the samples Whisper expects.
 *
 * Lives on the main thread because AudioContext is not available inside a
 * worker; the resulting buffer is handed to the worker and transcribed there.
 */
export async function decodeForWhisper(audio: Blob): Promise<Float32Array> {
  const bytes = await audio.arrayBuffer();

  // The short path, and the only one that existed before. decodeAudioData
  // resamples to the context's rate, which does the 16 kHz conversion for us.
  try {
    const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
    const buffer = await ctx.decodeAudioData(bytes.slice(0));
    return toMono(buffer);
  } catch (err) {
    // Anything past roughly ninety minutes lands here. decodeAudioData has to
    // hold the entire file at Opus's native 48 kHz before it can resample it
    // down, and past about a gigabyte Chromium refuses the allocation and
    // reports it as "Unable to decode audio data" — the same message a corrupt
    // file gives, which is why this looked like a broken recording rather than
    // a long one. Decoding packet by packet never needs that allocation.
    const streamed = await decodeInBlocks(bytes).catch(() => null);
    if (streamed) return streamed;
    throw err;
  }
}

/** Folds an AudioBuffer down to one channel of samples. */
function toMono(buffer: AudioBuffer): Float32Array {
  // slice(), not the raw channel: getChannelData hands back a view into the
  // AudioBuffer's own memory, and the caller transfers what it gets from here.
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();

  // Fold every channel down to one, so a stereo mic does not halve the volume.
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += channel[i];
  }
  for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels;
  return mono;
}

/**
 * The long path: pull Opus packets out of the WebM container ourselves, decode
 * them a few at a time, and resample each block down to 16 kHz before the next
 * one is decoded. Peak memory is one block rather than the whole recording, so
 * length stops mattering.
 *
 * Returns null when the file is not the WebM/Opus that MediaRecorder writes,
 * which leaves the original decodeAudioData error as the one worth reporting.
 */
async function decodeInBlocks(bytes: ArrayBuffer): Promise<Float32Array | null> {
  const track = readOpusTrack(new Uint8Array(bytes));
  if (!track) return null;

  const blocks: Float32Array[] = [];
  let pending: Float32Array[] = [];
  let pendingFrames = 0;
  let failure: Error | null = null;

  const flush = async () => {
    if (!pendingFrames) return;
    const joined = concat(pending, pendingFrames);
    pending = [];
    pendingFrames = 0;
    blocks.push(await resampleTo16k(joined));
  };

  const decoder = new AudioDecoder({
    output: (frame) => {
      const plane = new Float32Array(frame.numberOfFrames);
      // Planar so channel 0 arrives on its own; a mono mic is the normal case
      // and a stereo one is folded below.
      frame.copyTo(plane, { planeIndex: 0, format: 'f32-planar' });
      if (frame.numberOfChannels > 1) {
        const other = new Float32Array(frame.numberOfFrames);
        for (let c = 1; c < frame.numberOfChannels; c++) {
          frame.copyTo(other, { planeIndex: c, format: 'f32-planar' });
          for (let i = 0; i < plane.length; i++) plane[i] += other[i];
        }
        for (let i = 0; i < plane.length; i++) plane[i] /= frame.numberOfChannels;
      }
      frame.close();
      pending.push(plane);
      pendingFrames += plane.length;
    },
    error: (e) => {
      failure = e instanceof Error ? e : new Error(String(e));
    },
  });

  decoder.configure({
    codec: 'opus',
    sampleRate: OPUS_RATE,
    numberOfChannels: track.channels,
    ...(track.description ? { description: track.description } : {}),
  });

  for (const packet of track.packets) {
    if (failure) break;
    // Every Opus packet stands alone, so all of them are key frames.
    decoder.decode(
      new EncodedAudioChunk({ type: 'key', timestamp: packet.timestampUs, data: packet.data }),
    );
    // Drain periodically rather than queueing the whole recording at once.
    if (pendingFrames >= BLOCK_FRAMES) {
      await decoder.flush();
      await flush();
    }
  }

  if (failure) {
    decoder.close();
    throw failure;
  }

  await decoder.flush();
  decoder.close();
  await flush();

  const total = blocks.reduce((n, b) => n + b.length, 0);
  return total ? concat(blocks, total) : null;
}

const EMPTY = new Float32Array(0);

function concat(parts: Float32Array[], total: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(total);
  let at = 0;
  for (let i = 0; i < parts.length; i++) {
    out.set(parts[i], at);
    at += parts[i].length;
    // Let each block go as it is copied. Holding all of them alongside the
    // joined array would double the peak on a long recording, which is the
    // exact kind of allocation this path exists to avoid.
    parts[i] = EMPTY;
  }
  return out;
}

/** Resamples one block of 48 kHz mono down to the 16 kHz Whisper wants. */
async function resampleTo16k(samples: Float32Array<ArrayBuffer>): Promise<Float32Array> {
  const length = Math.max(1, Math.round((samples.length * SAMPLE_RATE) / OPUS_RATE));
  const ctx = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const buffer = ctx.createBuffer(1, samples.length, OPUS_RATE);
  buffer.copyToChannel(samples, 0);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0).slice();
}

// ------------------------------------------------------------------ WebM

type OpusTrack = {
  channels: number;
  description: Uint8Array | null;
  packets: { data: Uint8Array; timestampUs: number }[];
};

const ID = {
  SEGMENT: 0x18538067,
  INFO: 0x1549a966,
  TIMECODE_SCALE: 0x2ad7b1,
  TRACKS: 0x1654ae6b,
  TRACK_ENTRY: 0xae,
  TRACK_NUMBER: 0xd7,
  CODEC_ID: 0x86,
  CODEC_PRIVATE: 0x63a2,
  AUDIO: 0xe1,
  CHANNELS: 0x9f,
  CLUSTER: 0x1f43b675,
  TIMECODE: 0xe7,
  SIMPLE_BLOCK: 0xa3,
  BLOCK_GROUP: 0xa0,
  BLOCK: 0xa1,
} as const;

/**
 * A deliberately small Matroska reader: enough to find the Opus track and the
 * blocks belonging to it, and nothing else. MediaRecorder writes a narrow,
 * predictable subset of the format, so the general case is not worth carrying.
 */
function readOpusTrack(data: Uint8Array): OpusTrack | null {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  /** EBML numbers are variable width; the leading zeros say how wide. */
  const vint = (pos: number, keepMarker: boolean) => {
    if (pos >= data.length) return null;
    const first = data[pos];
    if (first === 0) return null;
    let width = 1;
    for (let mask = 0x80; !(first & mask); mask >>= 1) width++;
    if (pos + width > data.length) return null;
    let value = keepMarker ? first : first & (0xff >> width);
    let allOnes = (first & (0xff >> width)) === 0xff >> width;
    for (let i = 1; i < width; i++) {
      value = value * 256 + data[pos + i];
      if (data[pos + i] !== 0xff) allOnes = false;
    }
    // An all-ones size means "until the parent ends", which MediaRecorder uses
    // for the Segment because it cannot know the length while still recording.
    return { value, width, unknown: !keepMarker && allOnes };
  };

  const uint = (pos: number, len: number) => {
    let n = 0;
    for (let i = 0; i < len; i++) n = n * 256 + data[pos + i];
    return n;
  };

  /** An ASCII element body, which is how Matroska stores a codec name. */
  const text = (pos: number, len: number) => {
    let out = '';
    // Trailing NULs are legal padding on a Matroska string.
    for (let i = 0; i < len && data[pos + i]; i++) out += String.fromCharCode(data[pos + i]);
    return out;
  };

  /** What one TrackEntry said about itself. */
  type Entry = { number: number; codec: string; channels: number; description: Uint8Array | null };
  const blank = (): Entry => ({ number: -1, codec: '', channels: 1, description: null });

  let timecodeScale = 1_000_000; // nanoseconds per tick; 1 ms is the default
  /** The TrackEntry being walked through right now. */
  let entry = blank();
  /**
   * The one that turned out to be Opus — the only track whose blocks we want.
   *
   * Held on an object rather than in a plain `let` because walk() below is
   * where it gets filled in, and TypeScript does not follow an assignment made
   * inside a nested function: it would go on believing this is still null.
   */
  const found: { opus: Entry | null } = { opus: null };
  const packets: { data: Uint8Array; timestampUs: number }[] = [];
  let clusterTime = 0;

  /** Elements we need to walk into rather than skip over. */
  const CONTAINERS = new Set<number>([
    ID.SEGMENT,
    ID.INFO,
    ID.TRACKS,
    ID.TRACK_ENTRY,
    ID.AUDIO,
    ID.CLUSTER,
    ID.BLOCK_GROUP,
  ]);

  const walk = (start: number, end: number): void => {
    let pos = start;
    while (pos < end) {
      const id = vint(pos, true);
      if (!id) return;
      const size = vint(pos + id.width, false);
      if (!size) return;
      const body = pos + id.width + size.width;
      const stop = size.unknown ? end : Math.min(body + size.value, end);

      switch (id.value) {
        case ID.TIMECODE_SCALE:
          timecodeScale = uint(body, size.value);
          break;
        case ID.TRACK_NUMBER:
          entry.number = uint(body, size.value);
          break;
        case ID.CODEC_ID:
          entry.codec = text(body, size.value);
          break;
        case ID.CODEC_PRIVATE:
          entry.description = data.slice(body, body + size.value);
          break;
        case ID.CHANNELS:
          entry.channels = uint(body, size.value) || 1;
          break;
        case ID.TRACK_ENTRY: {
          // Each field above belongs to the entry it sits inside, so they are
          // read into a scratch and kept only if this entry turns out to be the
          // Opus one. Held flat, as they were, a second track would silently
          // overwrite the first — and then its blocks would be fed to an Opus
          // decoder as if they were sound.
          const outer = entry;
          entry = blank();
          walk(body, stop);
          if (entry.codec.startsWith('A_OPUS')) found.opus = entry;
          entry = outer;
          break;
        }
        case ID.TIMECODE:
          clusterTime = uint(body, size.value);
          break;
        case ID.SIMPLE_BLOCK:
        case ID.BLOCK: {
          const track = vint(body, false);
          // Tracks always comes before the clusters, so by the time a block
          // arrives we know which track we actually want.
          if (!track || !found.opus || track.value !== found.opus.number) break;
          const at = body + track.width;
          // Block header: signed 16-bit time relative to the cluster, then flags.
          const relative = view.getInt16(at, false);
          const payload = at + 3;
          if (payload < stop) {
            packets.push({
              data: data.slice(payload, stop),
              timestampUs: Math.round(((clusterTime + relative) * timecodeScale) / 1000),
            });
          }
          break;
        }
        default:
          if (CONTAINERS.has(id.value)) walk(body, stop);
      }

      pos = size.unknown && CONTAINERS.has(id.value) ? stop : body + size.value;
      if (pos <= body - 1) return; // malformed; refuse to spin
    }
  };

  walk(0, data.length);

  // Nothing recognisable came back, so this is not the file we know how to read.
  if (!found.opus || !packets.length) return null;
  return { channels: found.opus.channels, description: found.opus.description, packets };
}
