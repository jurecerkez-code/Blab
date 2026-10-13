// When is a transcript Whisper stuck, and when is it just long?
//
// The detector used to gzip the whole transcript at once. A long talk always
// shares words with itself, so the ratio climbs with length alone: a
// 37 minute meeting measured 2.66 with no 400 character stretch of it above
// 1.93, and Blab told its owner Whisper had got stuck. Whisper's own 2.4 is
// measured over one 30 second window, and that is the scale a loop shows at.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { looping } from '../src/loops';

/** About twelve minutes of ordinary talk, with no repeats in it. */
const TALK = readFileSync(new URL('./fixtures/long-talk.txt', import.meta.url), 'utf8')
  .replace(/\s+/g, ' ')
  .trim();

/** One short stretch of the talk, about what Whisper hears in 30 seconds. */
const BIT = TALK.slice(0, 450);

/** Tokens rotating in an order that never repeats exactly, like "ti ki pi si". */
function rotation(count: number): string {
  const syllables = ['ti', 'ki', 'pi', 'si'];
  let x = 2463534242;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    // xorshift: deterministic, and no six-word run comes round again soon.
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out.push(syllables[(x >>> 0) % 4]);
  }
  return out.join(' ');
}

test('a long talk is not a loop, however long it gets', async () => {
  // The precondition the old detector tripped on: the whole is above 2.4.
  expect(TALK.length).toBeGreaterThan(10_000);
  expect(await looping(TALK)).toBe(false);
});

test('Whisper stuck on one phrase is a loop', async () => {
  const stuck = Array(150).fill('like a city').join(' ');
  expect(await looping(`${BIT} ${stuck} ${BIT}`)).toBe(true);
});

test('a loop buried in the middle of a long talk is still caught', async () => {
  const half = Math.floor(TALK.length / 2);
  const stuck = Array(60).fill('like a city').join(' ');
  expect(await looping(`${TALK.slice(0, half)} ${stuck} ${TALK.slice(half)}`)).toBe(true);
});

test('a loop right at the end of a long talk is still caught', async () => {
  const stuck = Array(60).fill('like a city').join(' ');
  expect(await looping(`${TALK} ${stuck}`)).toBe(true);
});

test('tokens rotating in every order are a loop', async () => {
  expect(await looping(`${BIT} ${rotation(400)}`)).toBe(true);
});

test('a person repeating themselves is not a loop', async () => {
  const said =
    'Three more minutes, three more minutes, three more minutes. Okay, the camera is ' +
    'working, the microphone is working, camera and microphone are working. Hello, ' +
    'hello, hello, how are you?';
  expect(await looping(`${BIT} ${said} ${TALK.slice(450, 900)}`)).toBe(false);
});

test('a short transcript is never called a loop', async () => {
  expect(await looping('okay okay okay okay okay okay okay okay')).toBe(false);
});
