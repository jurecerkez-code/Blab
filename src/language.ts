// Which language each stretch of a recording is in, from Whisper's own guess.
//
// Blab used to name English for every recording, because transformers.js
// cannot detect a language: it leaves that as a TODO and assumes English.
// Named English, Whisper writes English whatever it hears, and on Croatian
// that is not a transcript but a loose translation that invents what it
// cannot carry over. A call that switched to Croatian came back with people
// in it swapped for other people, and sentences nobody said.
//
// Whisper can still say what it hears. The worker asks it once per 30 second
// window (see guessLanguage there), and this file turns those guesses into
// stretches, each transcribed in its own language. Everything here is pure,
// so the thresholds are held to Whisper's real numbers in tests/language.spec.ts.

/** How likely each language is for one window, keyed by Whisper's code ('en', 'hr'). */
export type Guess = Record<string, number>;

/** Windows `from` up to (not including) `to`, all in one language. */
export type Stretch = { from: number; to: number; language: string };

/**
 * English this unlikely starts a stretch in another language.
 *
 * Leaving English is the dangerous direction: English transcribed as
 * Croatian is not a translation, it is a loop of "ti ki pi". So the bar is
 * set by the English that Whisper doubted most, measured on base, small and
 * medium. On a full half minute of speech that was muttered English at 0.12.
 * Croatian on small, the least sure of the three, sat between 0.003 and 0.14,
 * with most of every stretch under this.
 */
const ENTER = 0.05;

/**
 * The same bar for a recording with less than one window of speech, padded
 * out with silence to the 30 seconds Whisper always hears. The guess is
 * shakier there: six seconds of counting in English read 0.046 on small, so
 * the bar drops to where short Croatian voice notes sat, 0.01 and under.
 */
const ENTER_PADDED = 0.02;

/**
 * English this unlikely keeps a stretch going once it has started. Croatian
 * windows next to sure ones went as high as 0.14 on small; a stretch is one
 * conversation, not a coin toss every half minute. English either side of a
 * stretch never read under 0.37, bar the windows the speakers switched
 * language in, which hold some of both.
 */
const HOLD = 0.2;

/** Softmax over the language tokens' scores. Stable for any size of logit. */
export function fromLogits(scores: [string, number][]): Guess {
  const top = Math.max(...scores.map(([, s]) => s));
  const exp = scores.map(([lang, s]) => [lang, Math.exp(s - top)] as const);
  const sum = exp.reduce((n, [, e]) => n + e, 0);
  return Object.fromEntries(exp.map(([lang, e]) => [lang, e / sum]));
}

/**
 * Languages Whisper splits one language into, and the code to write it as.
 *
 * Croatian, Bosnian and Serbian are one language to the ear, and Whisper
 * shares its belief between the three window by window, so on its own none
 * of them may look likely. Counted together they are. Written as hr: named
 * hr or bs, Whisper medium wrote the same Latin text word for word, while
 * named sr it wrote Cyrillic with Russian letters mixed in ("Nemамо",
 * "Ясно"). Latin is how all three are commonly written.
 */
const SAME_AS: Record<string, string> = { bs: 'hr', sr: 'hr' };

/** The language with the most probability over these windows, English aside. */
function likeliest(guesses: Guess[]): string {
  const total = new Map<string, number>();
  for (const guess of guesses) {
    for (const [code, p] of Object.entries(guess)) {
      const lang = SAME_AS[code] ?? code;
      if (lang !== 'en') total.set(lang, (total.get(lang) ?? 0) + p);
    }
  }
  let best = 'en';
  let most = -1;
  for (const [lang, p] of total) {
    if (p > most) [best, most] = [lang, p];
  }
  return best;
}

/**
 * Windows into stretches. English unless Whisper was sure: a window under
 * ENTER starts a stretch, and the stretch takes in its neighbours on both
 * sides for as long as they stay under HOLD. Each stretch then gets the one
 * language Whisper liked best across all of it, so one conversation is not
 * cut into pieces by a guess that wobbles from window to window.
 *
 * `padded` says the windows hold less speech than Whisper hears at once.
 */
export function stretches(guesses: Guess[], padded = false): Stretch[] {
  const enter = padded ? ENTER_PADDED : ENTER;
  const en = guesses.map((g) => g.en ?? 0);
  const foreign = en.map(() => false);
  for (let i = 0; i < en.length; i++) {
    if (foreign[i] || en[i] >= enter) continue;
    let from = i;
    let to = i + 1;
    while (from > 0 && en[from - 1] < HOLD) from--;
    while (to < en.length && en[to] < HOLD) to++;
    foreign.fill(true, from, to);
  }

  const out: Stretch[] = [];
  for (let from = 0; from < en.length; ) {
    let to = from + 1;
    while (to < en.length && foreign[to] === foreign[from]) to++;
    out.push({ from, to, language: foreign[from] ? likeliest(guesses.slice(from, to)) : 'en' });
    from = to;
  }
  return out;
}
