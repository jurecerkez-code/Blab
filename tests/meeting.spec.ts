// features/meeting-audio.feature, the platform half — executed.
//
// Everything else in Blab behaves the same on every machine. This one control
// does not: Electron records the computer's own audio through a loopback
// device and has one on Windows alone. The app offered it everywhere anyway,
// and on a Mac passed 'systemsound', which is not a value Electron takes — so
// the checkbox said one thing and the recording was another, and the only hint
// came after Stop. The feature file had said "Windows only" the whole time.
import { expect, test } from '@playwright/test';

type Device = { platform: string; arch: string; systemAudio: boolean };

/** Boots the page as though the Electron shell reported this machine. */
async function bootAs(page: import('@playwright/test').Page, device: Device | null) {
  await page.addInitScript((d) => {
    // Pin the model so the first-run default cannot vary with the runner.
    localStorage.setItem('blab-model', 'base');
    // Saved ON, so a disabled control has something to actually override.
    localStorage.setItem('blab-capture-system', 'on');
    const w = window as unknown as Record<string, unknown>;
    w.showDirectoryPicker = async () => navigator.storage.getDirectory();
    if (d) {
      w.blab = {
        device: d,
        micStatus: async () => 'granted',
        requestMic: async () => true,
        openMicSettings: async () => {},
        setRecording: () => {},
        gitRoot: async () => null,
      };
    }
  }, device);
  await page.goto('/');
  await page.waitForSelector('#meeting', { state: 'attached' });
}

const MAC: Device = { platform: 'darwin', arch: 'arm64', systemAudio: false };
const LINUX: Device = { platform: 'linux', arch: 'x64', systemAudio: false };
const WINDOWS: Device = { platform: 'win32', arch: 'x64', systemAudio: true };

test.describe('where computer audio can be recorded', () => {
  for (const [name, device] of [
    ['macOS', MAC],
    ['Linux', LINUX],
  ] as const) {
    test(`on ${name} the control is not offered`, async ({ page }) => {
      await bootAs(page, device);
      const meeting = page.locator('#meeting');

      // Disabled, not merely unticked: an unticked box invites a click.
      await expect(meeting).toBeDisabled();
      // And forced off, even though the saved setting said on.
      await expect(meeting).not.toBeChecked();

      const label = page.locator('label.check', { has: meeting });
      await expect(label).toContainText('Windows only');
      await expect(label).toHaveAttribute('title', /loopback device/i);
    });
  }

  test('on Windows nothing is taken away', async ({ page }) => {
    await bootAs(page, WINDOWS);
    const meeting = page.locator('#meeting');
    await expect(meeting).toBeEnabled();
    // The setting saved earlier is still honoured.
    await expect(meeting).toBeChecked();
    await expect(page.locator('label.check', { has: meeting })).not.toContainText('Windows only');
  });

  test('in a browser the control is left alone', async ({ page }) => {
    // No shell to ask. A tab can share tab audio through the picker, which is
    // its own way of doing this, so nothing here should interfere.
    await bootAs(page, null);
    await expect(page.locator('#meeting')).toBeEnabled();
  });

  test('a finished recording does not hand the control back', async ({ page }) => {
    await bootAs(page, LINUX);
    await page.click('#setup-pick');
    await page.fill('#title', 'A meeting that was not one');

    await page.click('#record');
    await expect(page.locator('#record')).toHaveText(/stop/i);
    // Long enough for the recorder to be genuinely running.
    await page.waitForTimeout(600);
    await page.click('#record');

    // The interface re-enables the settings row once a recording ends. That
    // used to be unconditional, so the first Stop undid the platform check.
    await expect(page.locator('#meeting')).toBeDisabled({ timeout: 15_000 });
  });
});
