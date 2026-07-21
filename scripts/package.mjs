// Builds the installer and leaves it in the project folder.
//
// The staging happens in the system temp directory rather than next to the
// source, because electron-builder unpacks ~250 MB of fresh binaries and then
// renames the folder. On Windows, a virus scanner reading those new files
// holds them open just long enough for the rename to fail with EPERM, and a
// synced folder such as OneDrive does the same. Temp is watched by neither.
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BUILDER = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');

const out = await mkdtemp(path.join(tmpdir(), 'blab-build-'));

function run() {
  return new Promise((resolve, reject) => {
    const args = ['--win', 'nsis', `-c.directories.output=${out}`];
    const child = spawn(BUILDER, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`electron-builder exited ${code}`))));
  });
}

try {
  await run();

  const names = (await readdir(out)).filter((n) => /^Blab-Setup-.*\.exe$/.test(n));
  if (names.length === 0) throw new Error('electron-builder produced no installer.');

  for (const name of names) {
    const to = path.join(ROOT, name);
    await rename(path.join(out, name), to).catch(async (err) => {
      // rename cannot cross drives; fall back to a copy.
      if (err.code !== 'EXDEV') throw err;
      const { copyFile } = await import('node:fs/promises');
      await copyFile(path.join(out, name), to);
    });
    const { size } = await stat(to);
    console.log(`\n${name} is in the Blab folder — ${Math.round(size / 1e6)} MB. Double-click it.\n`);
  }
} finally {
  await rm(out, { recursive: true, force: true }).catch(() => {});
}
