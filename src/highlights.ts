// The lines of a talk that carried the most of it, picked without a model.
//
// This is deliberately not a summary. It writes no sentence that was not said:
// every line here is lifted whole out of the transcript, with the time it was
// said at, so a wrong pick costs you a dull line rather than a confident
// invention. A small language model would write smoother paragraphs and would
// also, on the kind of transcript a laptop at the back of a room produces,
// happily make up decisions nobody took.
//
// Two signals, no dependencies:
//
//   1. What the talk keeps coming back to. A word said forty times is its
//      subject; a word said once is an aside. This is Luhn's 1958 method and it
//      still works, on the condition that the words holding sentences together
//      are taken out first.
//   2. Where you were typing. A note written at 14 minutes says the speaker was
//      worth writing down at 14 minutes, and no statistic beats a human who was
//      in the room.
//
// The first signal is why the list below exists. Counting how many lines a word
// appears in gets rid of "the", which is in nearly all of them, but it cannot
// tell "we" from "migration" — both turn up in about a quarter of the lines of
// a real talk, and only one of them is what the talk is about. Naming the
// function words is the part that makes this work rather than produce a tidy
// ranking of the chattiest sentences. A language with no list here still gets
// the frequency cut, which is weaker but not nothing.

/** A candidate line. `at` is null for transcripts saved before times existed. */
export type Scored = { at: number | null; text: string };

/** How long after hearing something a note about it usually lands. */
const LAG_MS = 25_000;
/** And how far ahead, for someone writing down a heading as it is announced. */
const LEAD_MS = 3_000;
/** How much a note near a line is worth. Strong, but it cannot carry a line alone. */
const NOTED = 2;
/**
 * How much of its content a line may share with one already picked. Someone
 * making the same point four times running is how people talk, and Whisper
 * repeats itself outright when it cannot hear; without this the shortlist is
 * that one point, three times.
 */
const SAME = 0.5;
/**
 * Below this there is nothing to pick from and the honest answer is nothing.
 * Whisper's phrases run five to ten seconds, so this is about two minutes —
 * a recording you would simply read.
 */
const MIN_LINES = 12;
/**
 * A word in more than this share of the lines is holding them together rather
 * than filling them. Set high on purpose: the list below already removes the
 * words this would catch, and a talk that mentions its own subject in half its
 * lines is a talk about that subject, not a talk with a filler word problem.
 */
const COMMON = 0.6;

/**
 * The words that carry no subject: English, and then Croatian.
 *
 * Blab has written English only since 0.5.0, so the second half looks like
 * dead weight and is not. Highlights are worked out from transcript.md at the
 * moment a recording is opened, and that file can be older than the app
 * reading it — anyone who used the language picker while it existed still has
 * Croatian transcripts sitting in their folder, and dropping these words would
 * quietly make their shortlists worse for no gain.
 *
 * Kept in one list rather than one per language because a talk is in one
 * language and the other half costs a few string comparisons.
 */
const STOP = new Set(
  `
  the a an and or but if of to in on at by for from with without as is are was were be been being am
  it its this that these those there here they them their theirs we us our ours you your yours
  i me my mine he him his she her hers who whom whose which what when where why how
  so not no nor do does did doing done have has had having will would can could should shall may might must
  all any both each few more most much many other others some such than too very own same
  just now then also about into over under again once still even only ever never
  yes yeah okay ok right well um uh er hmm like get got go going one two thing things

  i u je na se da za od su ni ne s sa sam si smo ste jesu bi bio bila bilo bili biti
  li kao ali ili što šta koji koja koje kojih kada kad gdje kako zašto zato jer
  ovo ovaj ova ove taj ta to te ti tu tako ono oni one mi vi ja on ona
  nam vam im mu joj nas vas njih njega nju svoj svoje sve svi već još samo onda ovdje tamo
  ima imati može mogu treba trebati bude budu nema nije nisu jest jesam
  `
    .split(/\s+/)
    .filter(Boolean),
);

const WORDS = /[^\p{L}\p{N}']+/u;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(WORDS)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/**
 * Plain text into lines, for recordings transcribed before Blab wrote times.
 * They get highlights too, just nothing to click.
 */
export function sentences(text: string): Scored[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => ({ at: null, text: s.trim() }))
    .filter((s) => s.text.length > 0);
}

/**
 * True when two lines are about the same thing — the same words, or nearly
 * them. Measured against the shorter of the two, so "I'm not saying anything
 * less" is caught by the longer line it is a fragment of.
 *
 * Below three content words there is not enough to compare and anything short
 * of an exact match would be a guess, so short lines are only ever equal to
 * themselves.
 */
function saysTheSame(a: string[], b: string[]): boolean {
  const one = new Set(a);
  const two = new Set(b);
  let shared = 0;
  for (const w of one) if (two.has(w)) shared++;
  const smaller = Math.min(one.size, two.size);
  if (smaller < 3) return shared === one.size && shared === two.size;
  return shared / smaller > SAME;
}

/** True when a note was written close enough to this moment to be about it. */
function noted(at: number | null, notes: number[]): boolean {
  if (at == null) return false;
  return notes.some((t) => at >= t - LAG_MS && at <= t + LEAD_MS);
}

/**
 * The best `limit` lines, in the order they were said. Empty for a recording
 * too short to have a shape — a box saying nothing beats one padded out.
 */
export function highlights(lines: Scored[], noteTimes: number[] = [], limit?: number): Scored[] {
  const usable = lines.filter((l) => l.text.trim().length > 0);
  if (usable.length < MIN_LINES) return [];

  const n = usable.length;
  const tokens = usable.map((l) => words(l.text));

  // How often each word is said, and how many lines it turns up in. The first
  // is the subject of the talk; the second catches anything the list above
  // missed — a filler word peculiar to one speaker, or a language Blab has no
  // list for.
  const said = new Map<string, number>();
  const inLines = new Map<string, number>();
  for (const line of tokens) {
    for (const w of line) said.set(w, (said.get(w) ?? 0) + 1);
    for (const w of new Set(line)) inLines.set(w, (inLines.get(w) ?? 0) + 1);
  }

  const weight = (w: string) => ((inLines.get(w) ?? 0) / n > COMMON ? 0 : (said.get(w) ?? 0));

  const scores = usable.map((line, i) => {
    const content = new Set(tokens[i]);
    let score = 0;
    for (const w of content) score += weight(w);
    // Longer lines hold more words and would otherwise win by size alone.
    // Dividing by the square root leaves them an edge without handing them the
    // whole list.
    score /= Math.sqrt(Math.max(1, content.size));
    if (noted(line.at, noteTimes)) score *= NOTED;
    return { i, score };
  });

  // One line per minute or so of a normal talk, never fewer than three and
  // never so many that reading them stops being faster than reading the talk.
  const want = limit ?? Math.min(10, Math.max(3, Math.round(n / 12)));

  const picked: number[] = [];
  for (const { i, score } of [...scores].sort((a, b) => b.score - a.score)) {
    if (picked.length >= want || score <= 0) break;
    if (picked.some((j) => saysTheSame(tokens[i], tokens[j]))) continue;
    picked.push(i);
  }

  return picked.sort((a, b) => a - b).map((i) => usable[i]);
}
