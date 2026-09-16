import { test, expect } from '@playwright/test';
import { filterTimestampTokens } from '../src/tokens';

test('timestamp tokens are stripped from a stream', () => {
  const out = filterTimestampTokens([50364n, 42n, 50365n, 43n]);
  expect(out).toEqual([42n, 43n]);
});

test('words with digits survive the filter', () => {
  const out = filterTimestampTokens([120n, 121n]);
  expect(out).toEqual([120n, 121n]);
});

test('an all-timestamp run degrades to the end token, never empty', () => {
  const out = filterTimestampTokens([50364n, 50365n, 51864n]);
  expect(out).toEqual([50257n]);
});
