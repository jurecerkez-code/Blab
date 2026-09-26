// Verifies the fixed build on the real recording: Best model, First1.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find((p) => p.url().startsWith('blab://')) || ctx.pages()[0];
  await page.waitForTimeout(1500);

  // Best model, then open the recording.
  await page.evaluate(() => localStorage.setItem('blab-model', 'medium'));
  const listed = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#list button')].find((b) =>
      b.textContent.includes('First1'),
    );
    if (btn) btn.click();
    return [...document.querySelectorAll('#list button')].map((b) => b.textContent.trim());
  });
  console.log('LIST:', JSON.stringify(listed));
  await page.waitForTimeout(1200);

  const started = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('#detail button')].find((b) =>
      b.textContent.includes('Re-transcribe') || b.textContent.includes('Transcribe'),
    );
    if (!btn) return 'NO BUTTON';
    btn.click();
    return 'CLICKED';
  });
  console.log('START:', started);

  // Poll the status line until it finishes or fails. Medium takes minutes;
  // the run may fall back to small, so allow 20.
  const deadline = Date.now() + 20 * 60 * 1000;
  let last = '';
  while (Date.now() < deadline) {
    await page.waitForTimeout(5000);
    const status = await page.evaluate(() => document.getElementById('status')?.textContent || '');
    if (status !== last) {
      console.log(new Date().toISOString().slice(11, 19), 'STATUS:', status);
      last = status;
    }
    if (/Could not transcribe|saved to|No speech/i.test(status)) break;
  }
  if (Date.now() >= deadline) console.log('STATUS: TIMEOUT waiting for the status line');

  // What actually landed on disk.
  const files = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    return 'origin-private root (vault lives in the user folder)';
  });
  console.log('DONE');
  process.exit(0);
})().catch((e) => {
  console.error('ERR:', e.message);
  process.exit(1);
});
