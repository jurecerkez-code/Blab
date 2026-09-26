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

test('the out of memory detector catches every shape it dies in', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const { engineOutOfMemory } = await import('/src/engine-errors.ts');
    return {
      bare: engineOutOfMemory('1283623640'),
      alloc: engineOutOfMemory('failed to allocate a buffer of size 313468028'),
      grow: engineOutOfMemory('Cannot enlarge memory arrays. Should be 3493654528...'),
      oom: engineOutOfMemory('abort(OOM). Built with -s ABORTING_WASM=1'),
      plain: engineOutOfMemory('No audio in first1.'),
      empty: engineOutOfMemory(''),
    };
  });
  expect(out.bare).toBe(true);
  expect(out.alloc).toBe(true);
  expect(out.grow).toBe(true);
  expect(out.oom).toBe(true);
  expect(out.plain).toBe(false);
  expect(out.empty).toBe(false);
});
