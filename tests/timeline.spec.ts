// The time axis, the note clock and the highlights are all pure functions over
// text, so they are tested as such — no browser, no microphone, no model. The
// meter spec next door needs a real window because animation cannot be read off
// a page; none of this does.
import { expect, test } from '@playwright/test';
import { highlights, sentences } from '../src/highlights';
import { NoteClock } from '../src/notes';
import { fromChunks, parse, render, stamp } from '../src/timeline';

const S = 1000;
const M = 60 * S;

test.describe('the time axis', () => {
  test('a stamp is the recorded time, not the clock on the wall', () => {
    expect(stamp(0)).toBe('[00:00] ');
    expect(stamp(72 * S)).toBe('[01:12] ');
    expect(stamp(2 * 60 * M + 3 * M + 4 * S)).toBe('[2:03:04] ');
  });

  test('lines survive a round trip through the file', () => {
    const lines = [
      { at: 0, text: 'Right, we should start.' },
      { at: 74 * S, text: 'The deadline is the fourteenth.' },
      { at: 65 * M, text: 'Any questions?' },
    ];
    expect(parse(render(lines))).toEqual(lines);
  });

  test('the file keeps whole seconds, and only whole seconds', () => {
    // Whisper's times come back to the millisecond. A file people read gets
    // seconds, and that is all a click on a line needs to land in the right
    // place, so the rest is dropped rather than written down and rounded later.
    expect(render([{ at: 7280, text: 'for saying anything inside this chat?' }])).toBe(
      '[00:07] for saying anything inside this chat?',
    );
    expect(parse('[00:07] x')).toEqual([{ at: 7000, text: 'x' }]);
  });

  test('blank lines are dropped rather than stamped', () => {
    const out = render([
      { at: S, text: 'kept' },
      { at: 2 * S, text: '   ' },
      { at: 3 * S, text: 'also kept' },
    ]);
    expect(out.split('\n')).toHaveLength(2);
  });

  test('a file with no stamps in it reads back as null', () => {
    // Every transcript and every note written before this existed. The panel
    // uses the null to show them as they are rather than invent times.
    expect(parse('Just some words.\nAnd more of them.')).toBeNull();
  });

  test('an unstamped line belongs to the stamped one above it', () => {
    const lines = parse('[00:10] first\ncarried on\n[00:20] second');
    expect(lines).toEqual([
      { at: 10 * S, text: 'first\ncarried on' },
      { at: 20 * S, text: 'second' },
    ]);
  });

  test('text before the first stamp starts at the beginning', () => {
    expect(parse('written before Record\n[00:30] and after')).toEqual([
      { at: 0, text: 'written before Record' },
      { at: 30 * S, text: 'and after' },
    ]);
  });
});

test.describe('what comes back from Whisper', () => {
  // transformers.js builds its plain text as chunks.map(c => c.text).join(''),
  // so the chunks ARE the transcript. Anything dropped here is speech the user
  // said and will never see. Every case below is a shape the library really
  // produces — new_chunk() starts every chunk as {timestamp: [null, null]} and
  // only fills them in when Whisper closes the pair.

  test('a chunk with no closing timestamp keeps its words', () => {
    const lines = fromChunks([
      { chunks: [{ timestamp: [0, 4.5], text: ' Right, we should start.' }] },
      { chunks: [{ timestamp: [4.5, null], text: ' And the last thing I said.' }] },
    ]);
    expect(lines.map((l) => l.text)).toEqual(['Right, we should start.', 'And the last thing I said.']);
  });

  test('the leftover at the end of a recording is not thrown away', () => {
    // The bug: Whisper stops without a closing pair, the final chunk keeps
    // [null, null], and the end of the talk vanished out of transcript.md.
    const lines = fromChunks([
      {
        chunks: [
          { timestamp: [0, 6], text: ' The migration is blocked.' },
          { timestamp: [6, 11], text: ' The report moves to the fourteenth.' },
          { timestamp: [null, null], text: ' Thanks everyone, see you next week.' },
        ],
      },
    ]);
    expect(lines).toHaveLength(3);
    expect(lines[2].text).toBe('Thanks everyone, see you next week.');
    // It carries on from where the last one ended rather than jumping to zero.
    expect(lines[2].at).toBe(11_000);
  });

  test('no words are lost however the times arrive', () => {
    const chunks = [
      { timestamp: [0, 2], text: ' one' },
      { timestamp: [null, null], text: ' two' },
      { timestamp: [undefined, 9], text: ' three' },
      { text: ' four' },
      { timestamp: [12, null], text: ' five' },
    ];
    const said = chunks.map((c) => c.text).join('');
    const kept = fromChunks([{ chunks } as never]).map((l) => l.text).join(' ');
    expect(kept.split(/\s+/)).toEqual(said.trim().split(/\s+/));
  });

  test('times never go backwards when they are carried forward', () => {
    const lines = fromChunks([
      {
        chunks: [
          { timestamp: [0, 5], text: ' a' },
          { timestamp: [null, null], text: ' b' },
          { timestamp: [null, null], text: ' c' },
          { timestamp: [30, 34], text: ' d' },
        ],
      },
    ]);
    const times = lines.map((l) => l.at);
    expect(times).toEqual([...times].sort((x, y) => x - y));
  });

  test('an empty chunk adds no line', () => {
    const lines = fromChunks([
      { chunks: [{ timestamp: [0, 1], text: '  ' }, { timestamp: [1, 2], text: ' real' }] },
    ]);
    expect(lines).toHaveLength(1);
  });

  test('no chunks at all is empty, not a crash', () => {
    expect(fromChunks([{}])).toEqual([]);
    expect(fromChunks([])).toEqual([]);
  });
});

test.describe('the note clock', () => {
  /**
   * Types onto the end of the box the way a person does: one input event per
   * character. Testing whole strings in one call was how the first version
   * passed its tests and still stamped a whole paragraph with one time.
   */
  function typeOut(clock: NoteClock, from: string, text: string, at: number, gap = 200): string {
    let value = from;
    let t = at;
    for (const ch of text) {
      value += ch;
      clock.mark(value, value.length, t);
      t += gap;
    }
    return value;
  }

  test('a paragraph written across a talk is not one moment', () => {
    // The bug this replaced: a textarea wraps, so someone who never presses
    // Enter is writing one line, and the whole hour came back stamped with the
    // second the first word was typed.
    const clock = new NoteClock();
    let v = typeOut(clock, '', 'migration is blocked on the database team', 30 * S);
    // Listens for a minute, then writes the next thing down.
    v = typeOut(clock, v, ' report moves to the fourteenth', 120 * S);
    v = typeOut(clock, v, ' he will not commit to either', 400 * S);

    expect(clock.render(v).split('\n')).toEqual([
      '[00:30] migration is blocked on the database team',
      '[02:00] report moves to the fourteenth',
      '[06:40] he will not commit to either',
    ]);
  });

  test('one unbroken burst keeps one time', () => {
    // Typing does not stop just because it is slow. Only a real gap is a gap.
    const clock = new NoteClock();
    const v = typeOut(clock, '', 'the deadline is the fourteenth', 12 * S, 1500);
    expect(clock.render(v)).toBe('[00:12] the deadline is the fourteenth');
  });

  test('pressing Enter starts a new one straight away', () => {
    // Someone who does press Enter has said where a thought ends, and that is
    // worth taking at face value without waiting for a pause.
    const clock = new NoteClock();
    let v = typeOut(clock, '', 'first', 5 * S);
    v += '\n';
    clock.mark(v, v.length, 6 * S);
    v = typeOut(clock, v, 'second', 6.2 * S);
    expect(clock.render(v)).toBe('[00:05] first\n[00:06] second');
  });

  test('notes typed before Record keep no time', () => {
    // mark() is only ever called while recording, so text written before it has
    // no mark and goes to disk exactly as it always did.
    const clock = new NoteClock();
    expect(clock.render('written with nothing running')).toBe('written with nothing running');
  });

  test('what was already on screen when Record was pressed keeps its place', () => {
    const clock = new NoteClock();
    const before = 'jotted down before the talk started';
    clock.reset(before);
    const v = typeOut(clock, before, ' and this while it ran', 45 * S);
    expect(clock.render(v)).toBe(`${before}\n[00:45] and this while it ran`);
  });

  test('a new recording forgets the last one', () => {
    const clock = new NoteClock();
    typeOut(clock, '', 'old note', 90 * S);
    clock.reset();
    const v = typeOut(clock, '', 'new note', 2 * S);
    expect(clock.render(v)).toBe('[00:02] new note');
  });

  test('fixing a typo later does not split the sentence', () => {
    // A correction is not a new thought, however long afterwards it happens.
    const clock = new NoteClock();
    const v = typeOut(clock, '', 'ask about it', 30 * S);
    const fixed = 'ask him about it';
    for (let i = 0; i < 4; i++) {
      clock.mark(fixed.slice(0, 4 + i) + v.slice(3), 4 + i, 300 * S + i * 200);
    }
    expect(clock.render(fixed)).toBe('[00:30] ask him about it');
  });

  test('inserting between two notes does not steal the second one', () => {
    const clock = new NoteClock();
    let v = typeOut(clock, '', 'first', 10 * S);
    v += '\n';
    clock.mark(v, v.length, 11 * S);
    v = typeOut(clock, v, 'second', 12 * S);
    // Go back and add a word to the first note much later.
    const edited = 'first thing\nsecond';
    clock.mark(edited, 11, 200 * S);
    expect(clock.render(edited)).toBe('[00:10] first thing\n[00:11] second');
  });

  test('clearing the box leaves nothing behind', () => {
    const clock = new NoteClock();
    let v = typeOut(clock, '', 'one', 10 * S);
    v += '\n';
    clock.mark(v, v.length, 20 * S);
    v = typeOut(clock, v, 'two', 21 * S);
    // Select all, delete.
    clock.mark('', 0, 90 * S);
    expect(clock.render('')).toBe('');
  });

  test('the user’s own words are never altered', () => {
    // The worst possible bug here: this is the person's own writing.
    const clock = new NoteClock();
    const text = 'weird chars: [00:12] emoji \u{1F600} tab\there';
    const v = typeOut(clock, '', text, 8 * S);
    expect(clock.render(v)).toBe(`[00:08] ${text}`);
  });
});

test.describe('highlights', () => {
  // A meeting the length Whisper cuts one into: short phrases, two subjects
  // running through it, and the usual amount of nothing in between. Scored at
  // the scale it runs at — a handful of tidy sentences would prove nothing,
  // because separating the subject of a talk from its filler is exactly the
  // thing that needs enough lines to be visible.
  const talk = [
    'Right, okay, I think we can probably get started.',
    'Can everyone at the back hear me alright? Good.',
    'So the first thing is the database migration.',
    'The migration was supposed to finish last week and it did not.',
    'What happened is the migration script times out on the large tables.',
    'The database team has been rewriting that script since Tuesday.',
    'They think the migration will take another two weeks.',
    'Sorry, someone was asking about the tables. Yes, all of them.',
    'Second thing, the quarterly report.',
    'The report deadline has moved to the fourteenth of March.',
    'That is a week earlier than the report deadline we agreed.',
    'The report goes to the board on the fourteenth, so it cannot move again.',
    'Um. Yes. Sorry, where was I.',
    'Right, so the report needs the migration numbers in it.',
    'Which means the migration has to be done before the report deadline.',
    'That is the whole problem in one sentence.',
    'Anyway. Anything else from anyone?',
    'No? Okay.',
    'Thanks everyone, see you next week.',
  ].map((text, i) => ({ at: i * 30 * S, text }));

  test('a recording too short to have a shape gets nothing', () => {
    // Padding eight lines out into a summary would be inventing structure.
    expect(highlights(talk.slice(0, 8))).toEqual([]);
  });

  test('it picks the lines the talk is actually about', () => {
    const picked = highlights(talk).map((h) => h.text);
    expect(picked.length).toBeGreaterThan(0);
    // Every pick has to be about one of the two things the meeting was about.
    for (const line of picked) expect(line).toMatch(/migration|report/i);
    // And none of them is the chat around it, however chatty.
    expect(picked).not.toContain('Um. Yes. Sorry, where was I.');
    expect(picked).not.toContain('Thanks everyone, see you next week.');
    expect(picked).not.toContain('Right, okay, I think we can probably get started.');
  });

  test('nothing is written that was not said', () => {
    for (const pick of highlights(talk)) {
      expect(talk.map((l) => l.text)).toContain(pick.text);
    }
  });

  test('picks come back in the order they were said', () => {
    const times = highlights(talk).map((h) => h.at as number);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  /** A line the statistics on their own do not rate. */
  const dull = talk.findIndex((l) => l.text.startsWith('The database team has been'));

  test('a note pulls its line up the list', () => {
    const plain = highlights(talk, [], 3).map((h) => h.text);
    // Someone wrote something down eight seconds after hearing it.
    const noted = highlights(talk, [talk[dull].at + 8 * S], 3).map((h) => h.text);
    expect(plain).not.toContain(talk[dull].text);
    expect(noted).toContain(talk[dull].text);
  });

  test('a note far from a line does not lift it', () => {
    const noted = highlights(talk, [talk[dull].at - 10 * M], 3).map((h) => h.text);
    expect(noted).not.toContain(talk[dull].text);
  });

  test('the same point made four times is one highlight', () => {
    // How people actually talk, and the first thing the real recordings showed:
    // without this the shortlist was one sentence rephrased three times.
    const said = [
      ...talk,
      { at: 600 * S, text: 'I am not saying the migration is late, I am saying the report cannot wait.' },
      { at: 630 * S, text: 'I am saying the report cannot wait for the migration.' },
      { at: 660 * S, text: 'The report cannot wait, is what I am saying about the migration.' },
    ];
    const picked = highlights(said, [], 3).map((h) => h.text);
    const rephrasings = picked.filter((p) => p.includes('cannot wait'));
    expect(rephrasings).toHaveLength(1);
  });

  test('a stuck Whisper loop is one highlight at most', () => {
    // The failure this app has already seen: one phrase, hundreds of times.
    // The loop is on the talk's own words, which is the hard case — it is the
    // top-scoring line in the recording and it is there twenty times.
    const stuck = [...talk];
    for (let i = 0; i < 20; i++) {
      stuck.push({ at: (talk.length + i) * 30 * S, text: 'The migration report deadline.' });
    }
    const texts = highlights(stuck).map((h) => h.text);
    expect(texts).toContain('The migration report deadline.');
    expect(new Set(texts).size).toBe(texts.length);
  });

  test('an old transcript with no times still gets highlights', () => {
    const plain = talk.map((l) => l.text).join(' ');
    const picked = highlights(sentences(plain));
    expect(picked.length).toBeGreaterThan(0);
    // Nowhere to jump to, and it says so rather than guessing a second.
    expect(picked.every((p) => p.at === null)).toBe(true);
  });
});
