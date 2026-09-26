// Blab 0.7 features: the model picker, meeting capture switch, import, the
// atomic transcript write, and the subtitle exports. Same house style as the
// other specs: real modules, real files, in origin-private storage.
import { expect, test } from '@playwright/test';

/** Runs `body` against a scratch folder in origin-private storage. */
async function inScratch<T>(page: import('@playwright/test').Page, body: string): Promise<T> {
  return page.evaluate(async (src) => {
    const vault = await import('/src/vault.ts');
    const root = await navigator.storage.getDirectory();
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

test('The model picker lists the catalog and remembers the choice', async ({ page }) => {
  // A real folder to connect, standing in for the directory picker. The
  // machine-based first-run default is pinned to base so the test is stable
  // no matter what laptop it runs on.
  await page.addInitScript(() => {
    localStorage.setItem('blab-model', 'base');
    (window as unknown as Record<string, unknown>).showDirectoryPicker = async () =>
      navigator.storage.getDirectory();
  });
  await page.goto('/');
  await page.click('#setup-pick');

  const options = page.locator('#model option');
  await expect(options).toHaveCount(3);
  await expect(page.locator('#model')).toHaveValue('base');

  await page.selectOption('#model', 'small');
  const saved = await page.evaluate(() => localStorage.getItem('blab-model'));
  expect(saved).toBe('small');

  // The checkbox travels the same way.
  await page.check('#meeting');
  expect(await page.evaluate(() => localStorage.getItem('blab-capture-system'))).toBe('on');
  await page.reload();
  await expect(page.locator('#meeting')).toBeChecked();
});

test('The first-run default follows the machine', async ({ page }) => {
  const seen = await page.evaluate(async () => {
    const { suggestedModel } = await import('/src/models.ts');
    window.blab = {
      device: { platform: 'darwin', arch: 'arm64' },
    } as unknown as typeof window.blab;
    const onSilicon = suggestedModel();
    window.blab = {
      device: { platform: 'win32', arch: 'x64' },
    } as unknown as typeof window.blab;
    navigator.hardwareConcurrency; // force the read path used below
    const onDesktop = suggestedModel();
    return { onSilicon, onDesktop };
  });
  // Apple Silicon always gets the best model; x64 gets small only when the
  // machine looks modern (cores check), otherwise base.
  expect(seen.onSilicon).toBe('medium');
  expect(['small', 'base']).toContain(seen.onDesktop);
});

test('Importing puts the file in a recording folder under its own format', async ({ page }) => {
  const seen = await inScratch<{ names: string[]; found: string | null }>(
    page,
    `// A tiny real WAV (44-byte header + 1 s of silence at 16 kHz mono).
     const header = new Uint8Array([
       0x52,0x49,0x46,0x46, 0x24,0x08,0x00,0x00, 0x57,0x41,0x56,0x45, 0x66,0x6d,0x74,0x20,
       0x10,0x00,0x00,0x00, 0x01,0x00, 0x01,0x00, 0x80,0x3e,0x00,0x00, 0x00,0x7d,0x00,0x00,
       0x02,0x00, 0x10,0x00, 0x64,0x61,0x74,0x61, 0x00,0x08,0x00,0x00,
     ]);
     const wav = new File([header, new Uint8Array(16000 * 2)], 'lecture.wav', { type: 'audio/wav' });
     const dir = await vault.importAudio(root, wav, 'Lecture', new Date(2026, 0, 5, 10, 30));
     const handle = await root.getDirectoryHandle(dir);
     const names = [];
     for await (const e of handle.values()) names.push(e.name);
     const found = (await vault.findAudio(handle))?.name ?? null;
     return { names, found };`,
  );
  expect(seen.names).toContain('audio.wav');
  expect(seen.found).toBe('audio.wav');
});

test('findAudio prefers the format Blab writes', async ({ page }) => {
  const found = await inScratch<string | null>(
    page,
    `const dir = await root.getDirectoryHandle('rec', { create: true });
     await vault.write(dir, 'audio.webm', 'webm');
     await vault.write(dir, 'audio.wav', 'wav');
     return (await vault.findAudio(dir))?.name ?? null;`,
  );
  expect(found).toBe('audio.webm');
});

test('writeAtomic leaves the final file and no .part behind', async ({ page }) => {
  const seen = await inScratch<string[]>(
    page,
    `const dir = await root.getDirectoryHandle('rec', { create: true });
     await vault.writeAtomic(dir, 'transcript.md', '[00:00] hello');
     const names = [];
     for await (const e of dir.values()) names.push(e.name);
     return names;`,
  );
  expect(seen).toContain('transcript.md');
  expect(seen).not.toContain('transcript.md.part');
});

test('Timed transcripts export to SRT and VTT', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const { toSrt, toVtt } = await import('/src/timeline.ts');
    const lines = [
      { at: 0, text: 'One' },
      { at: 4500, text: 'Two' },
      { at: 9200, text: 'Three' },
    ];
    return { srt: toSrt(lines), vtt: toVtt(lines) };
  });
  expect(out.srt).toContain('00:00:00,000 --> 00:00:04,500\nOne');
  expect(out.srt).toContain('\n3\n00:00:09,200 --> 00:00:13,200\nThree');
  expect(out.vtt).toContain('WEBVTT');
  expect(out.vtt).toContain('00:00:04.500 --> 00:00:09.200\nTwo');
});

test('Copy all gives pure text: every word, no stamps, no headings', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const { plainText } = await import('/src/timeline.ts');
    const stamped = [
      '[00:05] I need another prompt basically to explain',
      '[00:12] the system on how to delegate.',
      '[1:02:03] all of those 744 cases needs to put in some sort',
    ].join('\n');
    const untimed = 'just words, no stamps here';
    return { plain: plainText(stamped), untimed: plainText(untimed) };
  });
  expect(out.plain).toBe(
    'I need another prompt basically to explain\nthe system on how to delegate.\nall of those 744 cases needs to put in some sort',
  );
  expect(out.plain).not.toContain('[');
  // An old transcript saved before Blab timed it copies exactly as it is.
  expect(out.untimed).toBe('just words, no stamps here');
});

test('Overlapping transcript writes all land, one at a time', async ({ page }) => {
  const out = await page.evaluate(async () => {
    const vault = await import('/src/vault.ts');
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('race', { create: true });
    // What a transcription does: a partial save still holding the .part file
    // while the next save starts. The final text must be the one on disk.
    const jobs = [
      vault.writeAtomic(dir, 'transcript.md', 'one'),
      vault.writeAtomic(dir, 'transcript.md', 'two'),
      vault.writeAtomic(dir, 'transcript.md', 'three'),
      vault.writeAtomic(dir, 'transcript.md', 'four'),
    ];
    await Promise.all(jobs);
    const file = await dir.getFileHandle('transcript.md');
    const text = await (await file.getFile()).text();
    const names = [];
    for await (const e of dir.values()) names.push(e.name);
    return { text, names, errors: [] };
  }).catch((err) => ({ error: String(err && err.message || err) }));
  if (out.error) throw new Error('overlapping writes collided: ' + out.error);
  expect(out.text).toBe('four');
  expect(out.names).not.toContain('transcript.md.part');
});
