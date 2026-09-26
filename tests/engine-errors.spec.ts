// The engine dies in shapes a person cannot read: a bare wasm abort number,
// an allocation size. engineWords turns those into words with a next step.
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('engine failures become words with a next step', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const { engineWords } = await import('/src/engine-errors.ts');
    return {
      bare: engineWords('1283623640'),
      alloc: engineWords('failed to allocate a buffer of size 313468028'),
      grow: engineWords('Cannot enlarge memory arrays.'),
      plain: engineWords('No audio in first1.'),
    };
  });
  expect(out.bare).toContain('ran out of memory');
  expect(out.bare).toContain('Balanced');
  expect(out.alloc).toContain('ran out of memory');
  expect(out.grow).toContain('ran out of memory');
  expect(out.plain).toBe('No audio in first1.');
});
