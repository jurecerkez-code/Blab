// Executes features/live-meter.feature. Each test name is the scenario name,
// so the feature file stays the readable spec and this stays the proof.
//
// These run in a real browser with a real compositor, which matters more than
// it sounds: requestAnimationFrame does not fire in a window that is never
// painted, so the animation loop can only be proven here.
import { expect, test } from '@playwright/test';

/** Vertical scale of each bar, straight off the inline style the meter writes. */
const BAR_SCALES = `
  [...document.querySelectorAll('#meter .bar')].map((b) => {
    const m = b.style.transform.match(/scaleY\\(([\\d.]+)\\)/);
    return m ? Number(m[1]) : 0;
  })
`;

/** Resting height. Bars sit here when nothing is being heard. */
const FLOOR = 0.06;

declare global {
  /**
   * A meter of our own to drive. The page already builds one on #meter, and
   * hanging a second Meter off that element would stack a second set of bars
   * on top of the app's own.
   */
  function freshMeterHost(): HTMLElement;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).freshMeterHost = () => {
      const el = document.createElement('div');
      el.className = 'meter';
      document.body.append(el);
      return el;
    };
  });
  await page.goto('/');
});

test('Bars are still before recording starts', async ({ page }) => {
  const meter = page.locator('#meter');
  await expect(meter.locator('.bar')).toHaveCount(14);
  await expect(meter).not.toHaveClass(/live/);
  await expect(meter).toHaveAttribute('aria-hidden', 'true');

  // The idle colour is the line colour, not the accent.
  const colour = await meter.locator('.bar').first().evaluate((b) => getComputedStyle(b).backgroundColor);
  expect(colour).toBe('rgb(51, 51, 42)');
});

test('Bars move with the voice', async ({ page }) => {
  const moved = await page.evaluate(async () => {
    const { Meter } = await import('/src/meter.ts');
    const { Recorder } = await import('/src/recorder.ts');
    const host = freshMeterHost();
    const meter = new Meter(host);

    // The real path: the recorder opens the microphone, the meter watches it.
    const recorder = new Recorder();
    await recorder.start();
    await meter.start(recorder.mediaStream!);

    // No draw() by hand anywhere here. If requestAnimationFrame is not running,
    // these samples come back identical and the test fails, which is the whole
    // point of running in a real browser.
    const sample = () =>
      [...host.querySelectorAll('.bar')].map((b) => {
        const m = (b as HTMLElement).style.transform.match(/scaleY\(([\d.]+)\)/);
        return m ? Number(m[1]) : 0;
      });

    const frames: number[][] = [];
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 120));
      frames.push(sample());
    }

    const peak = Math.max(...frames.flat());
    const changed = frames.some((f, i) => i > 0 && f.some((v, j) => v !== frames[i - 1][j]));
    // Read while it is still running. After stop() the class is gone by design.
    const live = host.classList.contains('live');

    meter.stop();
    await recorder.stop();
    return { peak, changed, live };
  });

  expect(moved.live).toBe(true);
  // Something was heard...
  expect(moved.peak).toBeGreaterThan(FLOOR);
  // ...and it was the animation loop that showed it, not a single paint.
  expect(moved.changed).toBe(true);
});

test('A dead microphone is obvious straight away', async ({ page }) => {
  const bars = await page.evaluate(async () => {
    const { Meter } = await import('/src/meter.ts');
    const host = freshMeterHost();
    const meter = new Meter(host);

    // A stream with nothing connected: the microphone that hears nothing.
    const ctx = new AudioContext();
    await meter.start(ctx.createMediaStreamDestination().stream);
    await new Promise((r) => setTimeout(r, 600));

    const out = [...host.querySelectorAll('.bar')].map((b) => {
      const m = (b as HTMLElement).style.transform.match(/scaleY\(([\d.]+)\)/);
      return m ? Number(m[1]) : 0;
    });
    meter.stop();
    await ctx.close();
    return out;
  });

  expect(bars).toHaveLength(14);
  for (const scale of bars) expect(scale).toBeLessThanOrEqual(FLOOR + 0.001);
});

test('The meter never asks for the microphone a second time', async ({ page }) => {
  const calls = await page.evaluate(async () => {
    const { Meter } = await import('/src/meter.ts');
    const { Recorder } = await import('/src/recorder.ts');

    let asked = 0;
    const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => {
      asked++;
      return real(c);
    };

    const recorder = new Recorder();
    const meter = new Meter(freshMeterHost());
    await recorder.start();
    await meter.start(recorder.mediaStream!);
    await new Promise((r) => setTimeout(r, 200));

    const tracks = recorder.mediaStream!.getAudioTracks().length;
    meter.stop();
    await recorder.stop();
    navigator.mediaDevices.getUserMedia = real;
    return { asked, tracks };
  });

  expect(calls.asked).toBe(1);
  expect(calls.tracks).toBe(1);
});

test('Stopping releases everything', async ({ page }) => {
  const after = await page.evaluate(async () => {
    const { Meter } = await import('/src/meter.ts');
    const { Recorder } = await import('/src/recorder.ts');
    const host = freshMeterHost();
    const meter = new Meter(host);
    const recorder = new Recorder();

    await recorder.start();
    await meter.start(recorder.mediaStream!);
    await new Promise((r) => setTimeout(r, 200));

    // Held so its state can be read after the meter drops its own reference.
    const ctx = (meter as unknown as { ctx: AudioContext }).ctx;
    meter.stop();
    await new Promise((r) => setTimeout(r, 150));
    const blob = await recorder.stop();

    const internals = meter as unknown as Record<string, unknown>;
    return {
      contextState: ctx.state,
      cleared: internals.ctx === null && internals.source === null && internals.analyser === null,
      frameCleared: internals.frame === undefined,
      live: host.classList.contains('live'),
      transformsReset: [...host.querySelectorAll('.bar')].every((b) => (b as HTMLElement).style.transform === ''),
      // The recording itself must be unharmed by any of that.
      recordedBytes: blob.size,
    };
  });

  expect(after.contextState).toBe('closed');
  expect(after.cleared).toBe(true);
  expect(after.frameCleared).toBe(true);
  expect(after.live).toBe(false);
  expect(after.transformsReset).toBe(true);
  expect(after.recordedBytes).toBeGreaterThan(0);
});

test('Recording survives a meter that cannot start', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { Meter } = await import('/src/meter.ts');
    const { Recorder } = await import('/src/recorder.ts');
    const host = freshMeterHost();
    const meter = new Meter(host);
    const recorder = new Recorder();

    await recorder.start();
    let threw = false;
    // Not a MediaStream. createMediaStreamSource will reject it outright.
    try {
      await meter.start({} as MediaStream);
    } catch {
      threw = true;
    }
    await new Promise((r) => setTimeout(r, 200));
    const blob = await recorder.stop();

    return {
      threw,
      live: host.classList.contains('live'),
      ctxCleared: (meter as unknown as { ctx: unknown }).ctx === null,
      recordedBytes: blob.size,
    };
  });

  expect(result.threw).toBe(false);
  expect(result.live).toBe(false);
  expect(result.ctxCleared).toBe(true);
  // The recording is the thing that must not be lost.
  expect(result.recordedBytes).toBeGreaterThan(0);
});

test('Repeated recordings do not accumulate resources', async ({ page }) => {
  const cycles = await page.evaluate(async () => {
    const { Meter } = await import('/src/meter.ts');
    const { Recorder } = await import('/src/recorder.ts');
    const meter = new Meter(freshMeterHost());
    const seen: AudioContext[] = [];

    for (let i = 0; i < 5; i++) {
      const recorder = new Recorder();
      await recorder.start();
      await meter.start(recorder.mediaStream!);
      await new Promise((r) => setTimeout(r, 100));
      seen.push((meter as unknown as { ctx: AudioContext }).ctx);
      meter.stop();
      await recorder.stop();
    }
    await new Promise((r) => setTimeout(r, 150));
    return seen.map((c) => c.state);
  });

  expect(cycles).toHaveLength(5);
  // Every context from every cycle, including the last, is shut.
  for (const state of cycles) expect(state).toBe('closed');
});

test('The meter matches the existing dark interface', async ({ page }) => {
  const live = await page.evaluate(async () => {
    const { Meter } = await import('/src/meter.ts');
    const host = freshMeterHost();
    const meter = new Meter(host);
    const ctx = new AudioContext();
    await meter.start(ctx.createMediaStreamDestination().stream);
    const colour = getComputedStyle(host.querySelector('.bar')!).backgroundColor;
    meter.stop();
    await ctx.close();
    return colour;
  });

  // --accent, the same orange the Record button uses.
  expect(live).toBe('rgb(255, 180, 84)');
});

test('The bar layout does not shift because of the sample rate', async ({ page }) => {
  // Whatever rate this machine's audio stack picked, the bands must span the
  // speech range and never run backwards. Windows commonly opens at 48 kHz and
  // macOS at 44.1 kHz, and the edges are derived from the rate for that reason.
  const bands = await page.evaluate(async () => {
    const { Meter } = await import('/src/meter.ts');
    const meter = new Meter(freshMeterHost());
    const ctx = new AudioContext();
    await meter.start(ctx.createMediaStreamDestination().stream);
    const internals = meter as unknown as { edges: number[]; analyser: AnalyserNode };
    const out = {
      rate: ctx.sampleRate,
      edges: [...internals.edges],
      fftSize: internals.analyser.fftSize,
    };
    meter.stop();
    await ctx.close();
    return out;
  });

  expect(bands.fftSize).toBe(2048);
  expect(bands.edges).toHaveLength(15);
  // Rising, and every bar owns a bin the one before it does not.
  for (let i = 1; i < bands.edges.length; i++) {
    expect(bands.edges[i]).toBeGreaterThan(bands.edges[i - 1]);
  }
  // The top band reaches the speech ceiling, whatever the rate.
  const topHz = (bands.edges.at(-1)! * bands.rate) / bands.fftSize;
  expect(topHz).toBeGreaterThan(5000);
});
