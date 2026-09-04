// Executes features/where-recordings-live.feature.
//
// These need real directory handles, which rules out the pure-function style of
// timeline.spec.ts next door: what is being tested is a decision made about a
// folder on disk. Origin-private storage hands out Chromium's own
// FileSystemDirectoryHandle — the same type the folder picker returns — so the
// vault can be driven for real without a picker and without touching anybody's
// files.
import { expect, test } from '@playwright/test';

/** Runs `body` against a scratch folder in origin-private storage. */
async function inScratch<T>(page: import('@playwright/test').Page, body: string): Promise<T> {
  return page.evaluate(async (src) => {
    const vault = await import('/src/vault.ts');
    const root = await navigator.storage.getDirectory();
    // Start from nothing: OPFS outlives a reload, and a folder left by the last
    // test would make an assertion pass for the wrong reason.
    for await (const entry of (
      root as unknown as { values(): AsyncIterableIterator<{ name: string }> }
    ).values()) {
      await root.removeEntry(entry.name, { recursive: true });
    }
    const fn = new Function('vault', 'root', `return (async () => { ${src} })()`);
    return fn(vault, root);
  }, body);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('A fresh install has nothing in it', async ({ page }) => {
  await expect(page.locator('#setup')).toBeVisible();
  await expect(page.locator('#recorder')).toBeHidden();
  await expect(page.locator('#library')).toBeHidden();
  await expect(page.locator('#list').locator('li')).toHaveCount(0);
});

test('A git checkout is refused', async ({ page }) => {
  const seen = await inScratch<(string | null)[]>(
    page,
    `const plain = await root.getDirectoryHandle('plain', { create: true });
     const clone = await root.getDirectoryHandle('clone', { create: true });
     await clone.getDirectoryHandle('.git', { create: true });
     return [await vault.repoAround(clone), await vault.repoAround(plain)];`,
  );
  expect(seen).toEqual(['clone', null]);
});

test('A worktree or a submodule counts as a checkout', async ({ page }) => {
  const seen = await inScratch<string | null>(
    page,
    `const dir = await root.getDirectoryHandle('worktree', { create: true });
     // In a worktree or a submodule .git is a file pointing elsewhere.
     await vault.write(dir, '.git', 'gitdir: ../.git/worktrees/x');
     return vault.repoAround(dir);`,
  );
  expect(seen).toBe('worktree');
});

test('A folder deep inside a checkout is refused too', async ({ page }) => {
  const asked = await inScratch<[string | null, string | null, boolean]>(
    page,
    `const notes = await root.getDirectoryHandle('notes', { create: true });
     // Standing in for the desktop shell, the only thing that can see where a
     // folder is. There is no .git in this folder — only above it.
     let askedAbout = null;
     window.blab = {
       gitRoot: (n) => { askedAbout = n; return Promise.resolve('/Users/me/projekti/Blab'); },
     };
     const repo = await vault.repoAround(notes);
     // Nothing is written into the folder to find that out.
     const left = [];
     for await (const e of notes.values()) left.push(e.name);
     return [repo, askedAbout, left.length === 0];`,
  );
  // Named by its last segment, so the message names a repository, not a home folder.
  expect(asked[0]).toBe('Blab');
  // The shell is told which folder the page thinks it holds, so a stale grant
  // makes it answer null rather than describe somewhere else.
  expect(asked[1]).toBe('notes');
  expect(asked[2]).toBe(true);
});

test('Without a shell to ask, the folder itself is still checked', async ({ page }) => {
  const answer = await inScratch<(string | null)[]>(
    page,
    `const clone = await root.getDirectoryHandle('clone', { create: true });
     await clone.getDirectoryHandle('.git', { create: true });
     const notes = await root.getDirectoryHandle('notes', { create: true });
     // Browser build: no bridge at all.
     delete window.blab;
     return [await vault.repoAround(clone), await vault.repoAround(notes)];`,
  );
  expect(answer).toEqual(['clone', null]);
});

// The migration: a folder remembered by a version that allowed checkouts. The
// handle cannot be faked — it only ever comes from the picker — but an
// origin-private one is the same type and goes into IndexedDB the same way, so
// boot() can be walked through the whole path for real.
const REMEMBER_A_CHECKOUT = `
  const opfs = await navigator.storage.getDirectory();
  await opfs.removeEntry('FakeRepo', { recursive: true }).catch(() => {});
  const repo = await opfs.getDirectoryHandle('FakeRepo', { create: true });
  await repo.getDirectoryHandle('.git', { create: true });
  await new Promise((resolve) => {
    const req = indexedDB.open('blab', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => {
      const db = req.result;
      const store = db.transaction('handles', 'readwrite').objectStore('handles');
      store.put(repo, 'root');
      store.transaction.oncomplete = () => { db.close(); resolve(); };
    };
  });
`;

// One expression, used in both statement and arrow-body position: it has to
// start on this line (`return` followed by a newline returns undefined) and end
// without a semicolon (a semicolon in an arrow body is a syntax error).
const READ_BACK = `await new Promise((resolve) => {
    const req = indexedDB.open('blab', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => {
      const db = req.result;
      const got = db.transaction('handles', 'readonly').objectStore('handles').get('root');
      got.onsuccess = () => { db.close(); resolve(got.result ? got.result.name : null); };
    };
  })`;

test('A folder remembered from a version that allowed it', async ({ page }) => {
  expect(await page.evaluate(`(async () => { ${REMEMBER_A_CHECKOUT} return ${READ_BACK}; })()`)) //
    .toBe('FakeRepo');

  await page.reload();

  // Refused, and said why, naming the repository.
  await expect(page.locator('#status')).toContainText('will not record into FakeRepo');
  await expect(page.locator('#status')).toHaveClass(/error/);
  await expect(page.locator('#recorder')).toBeHidden();
  await expect(page.locator('#library')).toBeHidden();
  // Asking for a new folder, not offering the old one back.
  await expect(page.locator('#setup')).toBeVisible();
  await expect(page.locator('#setup-pick')).toHaveText('Pick a folder');
  // And dropped, rather than left to be refused again on every launch.
  await expect.poll(() => page.evaluate(`(async () => ${READ_BACK})()`)).toBe(null);
});
