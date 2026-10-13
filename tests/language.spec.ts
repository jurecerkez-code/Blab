// Which language each half minute of a recording is in, from Whisper's guess.
//
// Blab used to tell Whisper every recording was English. On speech that is not,
// Whisper does as it is told and writes English anyway: a loose translation
// that reads like a transcript and invents what it cannot carry over. A
// meeting that switched to Croatian came back with people in it swapped for
// other people, and sentences nobody said.
//
// Guessing wrong in the other direction is worse. English transcribed as
// Croatian is not a translation, it is a loop of "ti ki pi". So the bar to
// leave English is high, and the numbers here are Whisper's real guesses.
import { expect, test } from '@playwright/test';
import { fromLogits, stretches, type Guess } from '../src/language';

/** 'en:0.877 fi:0.03' → { en: 0.877, fi: 0.03 } */
const g = (s: string): Guess =>
  Object.fromEntries(s.split(' ').map((kv) => [kv.split(':')[0], Number(kv.split(':')[1])]));

// Whisper small inside the app, every 30 s of speech in a 37 minute call
// once the silence is cut: English small talk, five minutes of Croatian, an
// interview in English, ten minutes of Croatian, and a closing word in
// English. hr, bs and sr share the Croatian windows between them; to Whisper
// they are nearly one language. Times are speech time, not recording time.
const MEETING = [
  'en:0.890 ro:0.023 la:0.013 lv:0.011', // 00:00 English small talk
  'en:0.063 hr:0.703 bs:0.057 sk:0.037', // 00:30 Croatian
  'en:0.018 hr:0.668 bs:0.198 sr:0.072', // 01:00
  'en:0.086 hr:0.381 bs:0.216 sr:0.196', // 01:30
  'en:0.044 hr:0.546 bs:0.226 sr:0.082', // 02:00
  'en:0.030 hr:0.543 bs:0.231 sr:0.129', // 02:30
  'en:0.121 hr:0.281 sr:0.229 bs:0.191', // 03:00
  'en:0.025 sr:0.449 hr:0.259 bs:0.224', // 03:30
  'en:0.139 hr:0.250 bs:0.244 sr:0.239', // 04:00
  'en:0.033 hr:0.446 bs:0.314 sr:0.139', // 04:30
  'en:0.021 sr:0.374 bs:0.312 hr:0.268', // 05:00
  'en:0.312 hr:0.370 sr:0.145 bs:0.134', // 05:30 "let's switch to English"
  'en:0.980 ru:0.006 uk:0.001 cy:0.001', // 06:00
  'en:0.968 sl:0.004 el:0.003 sq:0.002', // 06:30
  'en:0.945 ru:0.006 hr:0.004 sl:0.004', // 07:00
  'en:0.992 cy:0.001 sl:0.001 ru:0.000', // 07:30
  'en:0.981 cy:0.003 ro:0.002 ru:0.002', // 08:00
  'en:0.984 cy:0.003 la:0.002 sl:0.001', // 08:30
  'en:0.922 ro:0.011 sl:0.008 el:0.006', // 09:00
  'en:0.961 fi:0.009 el:0.008 cy:0.004', // 09:30
  'en:0.959 ru:0.007 ro:0.004 sl:0.004', // 10:00
  'en:0.970 sl:0.003 ro:0.003 cy:0.002', // 10:30
  'en:0.969 ro:0.007 el:0.004 he:0.002', // 11:00
  'en:0.956 sl:0.006 ro:0.006 el:0.006', // 11:30
  'en:0.969 sl:0.005 el:0.003 cy:0.003', // 12:00
  'en:0.898 sl:0.025 fi:0.016 lv:0.010', // 12:30
  'en:0.866 ro:0.030 sl:0.025 sq:0.008', // 13:00
  'en:0.991 cy:0.001 ro:0.001 el:0.001', // 13:30
  'en:0.918 el:0.012 sl:0.010 fi:0.009', // 14:00
  'en:0.953 el:0.023 ro:0.005 fi:0.004', // 14:30
  'en:0.955 el:0.012 cy:0.005 sl:0.004', // 15:00
  'en:0.952 ro:0.008 fi:0.007 el:0.005', // 15:30
  'en:0.915 el:0.015 sl:0.009 hr:0.005', // 16:00
  'en:0.934 fi:0.014 el:0.013 sl:0.006', // 16:30
  'en:0.970 ru:0.004 sl:0.003 pt:0.002', // 17:00
  'en:0.971 sl:0.003 ro:0.003 fi:0.003', // 17:30
  'en:0.980 ro:0.005 el:0.004 cy:0.002', // 18:00
  'en:0.952 el:0.010 ro:0.006 fi:0.005', // 18:30
  'en:0.941 el:0.009 sl:0.007 ro:0.006', // 19:00
  'en:0.926 el:0.030 sl:0.009 ro:0.009', // 19:30
  'en:0.948 sl:0.006 ru:0.005 ro:0.005', // 20:00
  'en:0.974 sl:0.005 ru:0.003 ro:0.002', // 20:30
  'en:0.891 sv:0.012 fi:0.012 el:0.012', // 21:00
  'en:0.945 pt:0.004 ru:0.004 de:0.004', // 21:30
  'en:0.997 ru:0.000 cy:0.000 la:0.000', // 22:00
  'en:0.967 el:0.003 ro:0.003 cy:0.003', // 22:30
  'en:0.798 ro:0.038 pl:0.024 sl:0.020', // 23:00
  'en:0.821 ro:0.019 bs:0.016 lv:0.014', // 23:30
  'en:0.027 sr:0.501 bs:0.255 hr:0.154', // 24:00 Croatian again
  'en:0.022 sr:0.382 bs:0.301 hr:0.255', // 24:30
  'en:0.050 bs:0.330 hr:0.322 sr:0.208', // 25:00
  'en:0.030 hr:0.347 bs:0.317 sr:0.201', // 25:30
  'en:0.036 bs:0.317 sr:0.277 hr:0.271', // 26:00
  'en:0.034 sr:0.484 bs:0.308 hr:0.126', // 26:30
  'en:0.035 sr:0.496 bs:0.240 hr:0.187', // 27:00
  'en:0.030 sr:0.390 bs:0.321 hr:0.204', // 27:30
  'en:0.049 hr:0.304 bs:0.280 sr:0.241', // 28:00
  'en:0.003 sr:0.607 bs:0.206 hr:0.164 it:0.004', // 28:30
  'en:0.055 hr:0.332 bs:0.308 sr:0.208', // 29:00
  'en:0.100 hr:0.398 bs:0.232 sr:0.183', // 29:30
  'en:0.120 hr:0.283 sr:0.258 bs:0.231', // 30:00
  'en:0.037 bs:0.343 hr:0.303 sr:0.260', // 30:30
  'en:0.050 hr:0.443 bs:0.215 sr:0.149', // 31:00
  'en:0.056 hr:0.445 bs:0.275 sr:0.137', // 31:30
  'en:0.031 hr:0.664 bs:0.145 sr:0.112', // 32:00
  'en:0.044 hr:0.317 bs:0.278 sr:0.235', // 32:30
  'en:0.136 hr:0.398 bs:0.261 sr:0.059', // 33:00
  'en:0.838 ro:0.041 tr:0.010 sl:0.010', // 33:30 English to close
].map(g);

test.describe('which stretches are not English', () => {
  test('the call that switched languages comes back in five stretches', () => {
    expect(stretches(MEETING)).toEqual([
      { from: 0, to: 1, language: 'en' },
      { from: 1, to: 11, language: 'hr' },
      { from: 11, to: 48, language: 'en' },
      { from: 48, to: 67, language: 'hr' },
      { from: 67, to: 68, language: 'en' },
    ]);
  });

  test('an English talk is one English stretch', () => {
    // A voice message, five windows, never above 0.15 for anything else.
    const talk = ['en:0.85 nl:0.02', 'en:0.65 de:0.05', 'en:0.48 ro:0.08', 'en:0.75 fi:0.03', 'en:0.65 la:0.04'];
    expect(stretches(talk.map(g))).toEqual([{ from: 0, to: 5, language: 'en' }]);
  });

  test('Croatian that Balanced is less sure of is still a stretch', () => {
    // Whisper small inside the app, five minutes of the call above after the
    // silence was cut: Croatian throughout, and not one window under 0.02.
    // The first version of this file asked for 0.02 everywhere and wrote all
    // of it as English.
    const balanced = [
      'en:0.035 hr:0.705 sl:0.085',
      'en:0.064 hr:0.491 bs:0.251',
      'en:0.054 hr:0.361 bs:0.278',
      'en:0.022 hr:0.569 bs:0.255',
      'en:0.028 hr:0.567 bs:0.229',
      'en:0.108 hr:0.335 sr:0.211',
      'en:0.054 hr:0.421 sr:0.228',
      'en:0.027 sr:0.328 bs:0.323',
      'en:0.029 bs:0.355 hr:0.334',
    ];
    expect(stretches(balanced.map(g))).toEqual([{ from: 0, to: 9, language: 'hr' }]);
  });

  test('a short English clip Whisper is unsure about stays English', () => {
    // Eight seconds padded out to thirty: Whisper said Latin, and Latvian.
    expect(stretches([g('en:0.07 la:0.82')], true)).toEqual([{ from: 0, to: 1, language: 'en' }]);
    expect(stretches([g('en:0.06 lv:0.46')], true)).toEqual([{ from: 0, to: 1, language: 'en' }]);
  });

  test('a clip padded out with silence needs Whisper to be surer', () => {
    // The same guess, once on half a minute of speech and once on a few
    // seconds of it padded to half a minute, where the guess is shakier.
    const guess = g('en:0.04 hr:0.6');
    expect(stretches([guess])).toEqual([{ from: 0, to: 1, language: 'hr' }]);
    expect(stretches([guess], true)).toEqual([{ from: 0, to: 1, language: 'en' }]);
  });

  test('a quiet English start that Whisper hears as Croatian stays English', () => {
    // Whisper medium, the first minute of the call above: muttered English.
    const start = ['en:0.175 hr:0.30 la:0.15', 'en:0.117 hr:0.60 lv:0.11', 'en:0.626 ro:0.13'];
    expect(stretches(start.map(g))).toEqual([{ from: 0, to: 3, language: 'en' }]);
  });

  test('silence Whisper calls Norwegian does not start a stretch', () => {
    const quiet = ['en:0.83 la:0.03', 'en:0.073 nn:0.72', 'en:0.61 nn:0.18'];
    expect(stretches(quiet.map(g))).toEqual([{ from: 0, to: 3, language: 'en' }]);
  });

  test('a short Croatian voice note is Croatian', () => {
    // Eleven seconds, "molim te reci mi šta sam ja sada rekao".
    expect(stretches([g('en:0.00 hr:0.61 bs:0.14 sr:0.13')], true)).toEqual([
      { from: 0, to: 1, language: 'hr' },
    ]);
  });

  test('the doubtful windows at either edge of a Croatian stretch go with it', () => {
    // 0.10 alone would not start a stretch, but next to a sure one it is the
    // same conversation, still going.
    const edges = ['en:0.90 fi:0.01', 'en:0.10 hr:0.5', 'en:0.01 hr:0.7', 'en:0.12 hr:0.4', 'en:0.90 fi:0.01'];
    expect(stretches(edges.map(g))).toEqual([
      { from: 0, to: 1, language: 'en' },
      { from: 1, to: 4, language: 'hr' },
      { from: 4, to: 5, language: 'en' },
    ]);
  });

  test('a stretch takes the language Whisper liked best across all of it', () => {
    // sr wins two windows, hr wins one, but hr has the most in total.
    const split = ['en:0.01 sr:0.40 hr:0.38 bs:0.2', 'en:0.01 sr:0.41 hr:0.39 bs:0.1', 'en:0.01 hr:0.60 sr:0.2 bs:0.1'];
    expect(stretches(split.map(g))).toEqual([{ from: 0, to: 3, language: 'hr' }]);
  });

  test('Croatian that Whisper files under Serbian is still written in Latin letters', () => {
    // Whisper medium, ten minutes of the call above. Named sr, it wrote
    // Cyrillic with Russian letters mixed in ("Nemамо", "Ясно"); named hr or
    // bs it wrote the same Latin text, word for word.
    const serbianLeaning = ['en:0.00 sr:0.56 bs:0.38 hr:0.03', 'en:0.00 sr:0.48 bs:0.43 hr:0.05'];
    expect(stretches(serbianLeaning.map(g))).toEqual([{ from: 0, to: 2, language: 'hr' }]);
  });

  test('hr, bs and sr count together against a neighbouring language', () => {
    // Slovenian is the single likeliest, but the one language split three
    // ways has more of Whisper's belief between them.
    expect(stretches([g('en:0.01 sl:0.35 hr:0.25 bs:0.20 sr:0.19')])).toEqual([
      { from: 0, to: 1, language: 'hr' },
    ]);
  });

  test('nothing in, nothing out', () => {
    expect(stretches([])).toEqual([]);
  });
});

test.describe('reading the guess off the decoder', () => {
  test('scores become probabilities that add up to one', () => {
    const guess = fromLogits([
      ['en', 2],
      ['hr', 1],
      ['de', 0],
    ]);
    expect(Object.keys(guess)).toEqual(['en', 'hr', 'de']);
    expect(guess.en + guess.hr + guess.de).toBeCloseTo(1, 10);
    expect(guess.en).toBeGreaterThan(guess.hr);
    expect(guess.hr).toBeGreaterThan(guess.de);
  });

  test('huge logits do not overflow to nothing', () => {
    const guess = fromLogits([
      ['en', 1000],
      ['hr', 999],
    ]);
    expect(guess.en).toBeCloseTo(1 / (1 + Math.exp(-1)), 10);
    expect(Number.isFinite(guess.hr)).toBe(true);
  });
});
