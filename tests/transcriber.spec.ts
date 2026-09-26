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
  const { Transcriber, OutOfMemoryError } = await import('/src/transcriber.ts');
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
  const seen = await run<{ queued: boolean; fresh: boolean }>(
    page,
    `
    const t = new Transcriber(() => new FakeWorker());
    const p1 = t.transcribe(new Float32Array(8), 'base', () => {});
    const p2 = t.transcribe(new Float32Array(8), 'base', () => {});
    await tick();
    // Before the fix both jobs were already in the worker: sendTranscribe
    // posts synchronously, and it was evaluated as an argument to track().
    const queued = made.length === 1 && made[0].posted.length === 1;

    made[0].deliver(done(made[0].posted[0].id, 'one'));
    await p1;
    await tick();
    // A finished job drops the worker, so job 2 runs on a fresh one: the wasm
    // heap never frees itself while the worker lives, and the next job died
    // mid-run allocating on the tired one.
    const fresh = made.length === 2 && made[1].posted.length === 1 && made[0].terminated;

    made[1].deliver(done(made[1].posted[0].id, 'two'));
    await p2;
    return { queued, fresh };
  `,
  );
  expect(seen.queued).toBe(true);
  expect(seen.fresh).toBe(true);
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
    // The first job dropped its worker, so the second runs on a fresh one.
    latest().deliver(done(latest().posted[0].id, 'the second talk'));
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

test('a finished caption does not drop the worker', async ({ page }) => {
  const seen = await run<{ alive: boolean; stillOneWorker: boolean }>(
    page,
    `
    const t = new Transcriber(() => new FakeWorker());
    t.live(new Float32Array(8), 'base', 1200, () => {});
    await tick();
    latest().deliver({ type: 'live', id: latest().posted[0].id, text: 'half a sentence', at: 1200 });
    await tick();
    return { alive: !latest().terminated, stillOneWorker: made.length === 1 };
  `,
  );
  expect(seen.alive).toBe(true);
  expect(seen.stillOneWorker).toBe(true);
});

test('an out of memory failure is recognisable, not just text', async ({ page }) => {
  const seen = await run<{ oom: boolean; plain: boolean }>(
    page,
    `
    const t = new Transcriber(() => new FakeWorker());
    const p1 = t.transcribe(new Float32Array(8), 'medium', () => {});
    const p2 = t.transcribe(new Float32Array(8), 'base', () => {});
    await tick();
    latest().deliver({ type: 'failed', id: latest().posted[0].id, message: 'Whisper ran out of memory', modelMissing: false, oom: true });
    let oom = false;
    try { await p1; } catch (e) { oom = e instanceof OutOfMemoryError; }
    await tick();
    latest().deliver({ type: 'failed', id: latest().posted[0].id, message: 'boom', modelMissing: false });
    let plain = false;
    try { await p2; } catch (e) { plain = e instanceof Error && !(e instanceof OutOfMemoryError); }
    return { oom, plain };
  `,
  );
  expect(seen.oom).toBe(true);
  expect(seen.plain).toBe(true);
});
