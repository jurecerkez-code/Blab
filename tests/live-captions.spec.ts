// features/live-captions.feature, the parts that are arithmetic rather than
// audio. The ring is the one piece worth pinning: it runs on the main thread
// inside an audio callback about twelve times a second, so being wrong about
// it is a stutter in the recording, not just a wrong caption.
import { expect, test } from '@playwright/test';
import { Recent } from '../src/live-captions';

/** 1, 2, 3 … n, so a wrong offset is visible rather than merely different. */
const counting = (n: number, from = 1) =>
  Float32Array.from({ length: n }, (_, i) => i + from);

test.describe('the rolling window of recent audio', () => {
  test('an empty ring has nothing to give', () => {
    const r = new Recent(10);
    expect(r.length).toBe(0);
    expect(Array.from(r.tail(5))).toEqual([]);
  });

  test('what goes in comes back out, oldest first', () => {
    const r = new Recent(10);
    r.append(counting(4));
    expect(r.length).toBe(4);
    expect(Array.from(r.tail(4))).toEqual([1, 2, 3, 4]);
  });

  test('asking for more than there is gives what there is', () => {
    const r = new Recent(10);
    r.append(counting(3));
    expect(Array.from(r.tail(99))).toEqual([1, 2, 3]);
  });

  test('asking for less gives the newest end of it', () => {
    const r = new Recent(10);
    r.append(counting(6));
    // The caption window is always the most recent stretch, never the oldest.
    expect(Array.from(r.tail(2))).toEqual([5, 6]);
  });

  test('the oldest samples fall off the end once it is full', () => {
    const r = new Recent(5);
    r.append(counting(3)); // 1 2 3
    r.append(counting(4, 4)); // 4 5 6 7
    expect(r.length).toBe(5);
    expect(Array.from(r.tail(5))).toEqual([3, 4, 5, 6, 7]);
  });

  test('a write that wraps the end of the buffer still reads back in order', () => {
    // The whole point of writing in place: the newest samples straddle the
    // physical end of the array, and tail() has to stitch the two halves.
    const r = new Recent(5);
    r.append(counting(4)); // 1 2 3 4, head at 4
    r.append(counting(3, 5)); // 5 6 7 wraps to index 0..1
    expect(Array.from(r.tail(5))).toEqual([3, 4, 5, 6, 7]);
    expect(Array.from(r.tail(3))).toEqual([5, 6, 7]);
  });

  test('a chunk larger than the whole ring keeps only its own tail', () => {
    const r = new Recent(4);
    r.append(counting(10));
    expect(r.length).toBe(4);
    expect(Array.from(r.tail(4))).toEqual([7, 8, 9, 10]);
  });

  test('a pause empties it, and it fills again from nothing', () => {
    const r = new Recent(5);
    r.append(counting(5));
    r.clear();
    expect(r.length).toBe(0);
    r.append(counting(2, 100));
    // Length is what decides the caption's timestamp, so a stale length here
    // is a caption stamped up to thirteen seconds before it was said.
    expect(r.length).toBe(2);
    expect(Array.from(r.tail(5))).toEqual([100, 101]);
  });

  test('many small writes cost no more than the samples written', () => {
    // A regression guard with teeth: the old ring reallocated and copied the
    // entire buffer on every append. Two hundred appends into a full ring is
    // where that showed up.
    const r = new Recent(1000);
    for (let i = 0; i < 200; i++) r.append(counting(50, i * 50 + 1));
    expect(r.length).toBe(1000);
    const tail = r.tail(3);
    expect(Array.from(tail)).toEqual([9998, 9999, 10000]);
  });
});
