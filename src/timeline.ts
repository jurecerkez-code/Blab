// One time axis shared by the transcript and your notes.
//
// Both files store it the same way: a `[mm:ss]` prefix at the start of a line,
// counted from the beginning of the recording. Plain text, still greppable,
// still readable in any editor — which is the whole point of the folder.
//
// The two axes line up because a pause writes nothing. Recorded time and
// position in audio.webm are the same number, so a note typed at 14 minutes
// sits beside what was said at 14 minutes even if the talk had a break in it.
import { formatDuration } from './recorder';

/** A line of text and the moment in the recording it belongs to, in ms. */
export type Line = { at: number; text: string };

/** What the transcription pipeline hands back once timestamps are asked for. */
export type Chunked = { chunks?: { timestamp?: (number | null)[]; text: string }[] };

/**
 * Pipeline chunks into lines. Every word is kept — that is the whole rule here,
 * and it was worth learning the hard way.
 *
 * A chunk can arrive with no timestamps at all. transformers.js starts each one
 * as `[null, null]` and only fills them in when Whisper closes the pair, so the
 * leftover at the end of a recording, and any stretch where it never emitted a
 * closing timestamp, comes back untimed. An earlier version skipped those,
 * which quietly cut the end off the transcript.
 *
 * A chunk with no time of its own carries on from where the last one ended.
 * Being a few seconds out is a click that lands slightly early. Losing the
 * sentence is losing the sentence.
 */
export function fromChunks(parts: Chunked[]): Line[] {
  const out: Line[] = [];
  let carry = 0;
  for (const part of parts) {
    for (const chunk of part.chunks ?? []) {
      const [start, end] = chunk.timestamp ?? [];
      if (typeof start === 'number' && Number.isFinite(start)) carry = start;
      const text = chunk.text.trim();
      if (text) out.push({ at: Math.round(carry * 1000), text });
      if (typeof end === 'number' && Number.isFinite(end)) carry = end;
    }
  }
  return out;
}

/** Matches `[mm:ss] ` and `[h:mm:ss] ` at the start of a line. */
const STAMP = /^\[(?:(\d+):)?(\d{1,2}):(\d{2})\][ \t]?/;

export function stamp(ms: number): string {
  return `[${formatDuration(Math.max(0, ms))}] `;
}

/** Lines into one stamped block, ready to write to disk. */
export function render(lines: Line[]): string {
  return lines
    .filter((l) => l.text.trim())
    .map((l) => stamp(l.at) + l.text.trim())
    .join('\n');
}

/**
 * A stamped block back into lines, or null when nothing in it is stamped —
 * which is every recording made before this existed. Callers use the null to
 * fall back to showing the text as it is rather than inventing times for it.
 *
 * A line without a stamp is treated as a continuation of the one above, so a
 * note that wraps onto its own line does not lose its place.
 */
export function parse(text: string): Line[] | null {
  const lines: Line[] = [];
  let stamped = false;

  for (const raw of text.split('\n')) {
    const m = STAMP.exec(raw);
    if (m) {
      stamped = true;
      const [, h, mm, ss] = m;
      const at = ((Number(h ?? 0) * 60 + Number(mm)) * 60 + Number(ss)) * 1000;
      lines.push({ at, text: raw.slice(m[0].length) });
    } else if (lines.length) {
      lines[lines.length - 1].text += `\n${raw}`;
    } else if (raw.trim()) {
      // Text before the first stamp. Belongs to the start of the recording.
      lines.push({ at: 0, text: raw });
    }
  }

  if (!stamped) return null;
  return lines.filter((l) => l.text.trim()).map((l) => ({ ...l, text: l.text.trim() }));
}
