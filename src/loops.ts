// Noticing when Whisper got stuck, which is all transformers.js leaves us.

/**
 * Above this, a transcript is repetition rather than speech.
 *
 * Real Whisper decides this the same way and re-runs the chunk at a higher
 * temperature when it trips. transformers.js implements none of that; there is
 * no compression_ratio_threshold, no logprob_threshold, no temperature fallback
 * anywhere in the bundle, so Blab cannot re-decode. What it can do is notice,
 * and say so, which is the difference between a file you throw away and a file
 * you do not know to throw away.
 *
 * Ordinary English gzips to about 1.5-2.0 here. The looped recording that
 * prompted this measured 3.15.
 */
const LOOP_RATIO = 2.4;

/**
 * How much text one measurement covers: about what Whisper writes for one
 * 30 second window, which is what its own 2.4 is measured over.
 *
 * The whole transcript at once was the old way, and it was wrong. A long talk
 * shares words with itself, so its ratio climbs with length alone: a 37
 * minute meeting gzipped to 2.66 with no 400 character stretch of it above
 * 1.93, and its owner was told Whisper had got stuck. A real loop runs well
 * past 5 in any window it fills, so one window is plenty to see it.
 */
const WINDOW = 500;
/** Half a window, so a loop straddling two windows still fills one. */
const STEP = WINDOW / 2;

/** Gzip via the platform: no dependency, and the same metric Whisper uses. */
async function ratio(text: string): Promise<number> {
  const raw = new TextEncoder().encode(text);
  const gz = new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip')));
  return raw.byteLength / (await gz.arrayBuffer()).byteLength;
}

export async function looping(text: string): Promise<boolean> {
  // Short transcripts compress badly for boring reasons; there is no room for
  // a dictionary to pay for itself, so the ratio means nothing down there.
  if (text.length < 200) return false;
  try {
    // Every window full size, the last one flush with the end, so a loop in
    // the closing seconds is measured as fairly as one in the middle.
    const last = Math.max(0, text.length - WINDOW);
    for (let at = 0; ; at = Math.min(at + STEP, last)) {
      if ((await ratio(text.slice(at, at + WINDOW))) > LOOP_RATIO) return true;
      if (at === last) return false;
    }
  } catch {
    // A missing CompressionStream must never cost someone their transcript.
    return false;
  }
}
