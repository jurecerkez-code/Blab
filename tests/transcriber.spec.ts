// features/one-job-at-a-time.feature, executed.
//
// The real worker loads transformers.js and a model, which no spec can wait
// for, so the Transcriber takes a worker factory and these tests hand it a
// stand-in. That stand-in is the whole reason this file can exist: it records
// when a job reaches the worker, which is the thing the queue is supposed to
// control and the thing it was not controlling.
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

/** Installs the fake worker class and returns a Transcriber factory, in-page. */
const HARNESS = `
  const made = [];
  class FakeWorker {
    constructor() { this.listeners = []; this.posted = []; this.terminated = false; made.push(this); }
    addEventListener(_t, fn) { this.listeners.push(fn); }
    removeEventListener(_t, fn) { this.listeners = this.listeners.filter((l) => l !== fn); }
    postMessage(job) { this.posted.push(job); }
    terminate() { this.terminated = true; }
    deliver(msg) { for (const l of [...this.listeners]) l({ data: msg }); }
  }
  const tick = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  const done = (id, text) => ({ type: 'done', id, text, segments: [], degenerate: false, noSpeech: false });
  const { Transcriber } = await import('/src/transcriber.ts');
  const latest = () => made[made.length - 1];
`;

/** Runs `body` in the page with the harness above already set up. */
async function run<T>(page: import('@playwright/test').Page, body: string): Promise<T> {
  return page.evaluate(
    (src) => new Function(`return (async () => { ${src} })()`)() as Promise<T>,
    HARNESS + body,
  );
}

test('a second job waits for the first to finish', async ({ page }) => {
  const seen = await run<{ afterBoth: number; afterFirstDone: number }>(
    page,
    `
    const t = new Transcriber(() => new FakeWorker());
    const p1 = t.transcribe(new Float32Array(8), 'base', () => {});
    const p2 = t.transcribe(new Float32Array(8), 'base', () => {});
    await tick();
    // Before the fix both jobs were already in the worker: sendTranscribe
    // posts synchronously, and it was evaluated as an argument to track().
    const afterBoth = latest().posted.length;

    latest().deliver(done(latest().posted[0].id, 'one'));
    await p1;
    await tick();
    const afterFirstDone = latest().posted.length;

    latest().deliver(done(latest().posted[1].id, 'two'));
    await p2;
    return { afterBoth, afterFirstDone };
  `,
  );
  expect(seen.afterBoth).toBe(1);
  expect(seen.afterFirstDone).toBe(2);
});

test('both callers still get their own transcript', async ({ page }) => {
  const seen = await run<{ first: string; second: string }>(
    page,
    `
    const t = new Transcriber(() => new FakeWorker());
    const p1 = t.transcribe(new Float32Array(8), 'base', () => {});
    const p2 = t.transcribe(new Float32Array(8), 'base', () => {});
    await tick();
    latest().deliver(done(latest().posted[0].id, 'the first talk'));
    const first = (await p1).text;
    await tick();
    latest().deliver(done(latest().posted[1].id, 'the second talk'));
    const second = (await p2).text;
    return { first, second };
  `,
  );
  expect(seen.first).toBe('the first talk');
  expect(seen.second).toBe('the second talk');
});

test('a live caption is dropped rather than queued', async ({ page }) => {
  const posted = await run<number>(
    page,
    `
    const t = new Transcriber(() => new FakeWorker());
    const p1 = t.transcribe(new Float32Array(8), 'base', () => {});
    await tick();
    // Offered while a recording is being transcribed: dropped, not queued. A
    // caption computed a minute late is not a caption.
    t.live(new Float32Array(8), 'base', 0, () => {});
    await tick();
    const n = latest().posted.length;
    latest().deliver(done(latest().posted[0].id, 'x'));
    await p1;
    return n;
  `,
  );
  expect(posted).toBe(1);
});

test('a caption is accepted when nothing else is running', async ({ page }) => {
  const seen = await run<{ type: string; heard: string | null }>(
    page,
    `
    const t = new Transcriber(() => new FakeWorker());
    let heard = null;
    t.live(new Float32Array(8), 'base', 1200, (text) => { heard = text; });
    await tick();
    const job = latest().posted[0];
    latest().deliver({ type: 'live', id: job.id, text: 'half a sentence', at: 1200 });
    await tick();
    return { type: job.type, heard };
  `,
  );
  expect(seen.type).toBe('live');
  expect(seen.heard).toBe('half a sentence');
});

test('a job that fails does not wedge the queue', async ({ page }) => {
  const seen = await run<{ rejected: boolean; secondRan: boolean; text: string }>(
    page,
    `
    const t = new Transcriber(() => new FakeWorker());
    const p1 = t.transcribe(new Float32Array(8), 'base', () => {});
    await tick();
    // A real failure that is not a missing model drops the whole worker, so
    // the next job has to spawn a fresh one and still get through.
    latest().deliver({ type: 'failed', id: latest().posted[0].id, message: 'boom', modelMissing: false });
    let rejected = false;
    try { await p1; } catch { rejected = true; }
    await tick();

    const p2 = t.transcribe(new Float32Array(8), 'base', () => {});
    await tick();
    const secondRan = latest().posted.length === 1;
    latest().deliver(done(latest().posted[0].id, 'after the failure'));
    const text = (await p2).text;
    return { rejected, secondRan, text };
  `,
  );
  expect(seen.rejected).toBe(true);
  expect(seen.secondRan).toBe(true);
  expect(seen.text).toBe('after the failure');
});
