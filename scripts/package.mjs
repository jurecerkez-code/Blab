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
const WINDOWS = process.platform === 'win32';
const BUILDER = path.join(ROOT, 'node_modules', '.bin', WINDOWS ? 'electron-builder.cmd' : 'electron-builder');

// Windows has to go through a shell, because Node refuses to run a .cmd file
// without one. A shell splits on spaces, and plenty of people keep their code
// in a folder whose name has a space in it, so everything handed to it gets
// quoted. Without this the build dies on the first space in the path.
const quote = (s) => (WINDOWS && s.includes(' ') ? `"${s}"` : s);

const out = await mkdtemp(path.join(tmpdir(), 'blab-build-'));

// electron-builder only builds for the machine it runs on, so the host platform
// picks the target. Adding one is a line here plus a block in package.json.
const TARGETS = {
  // No target after --mac: naming one on the command line discards the arch
  // from the config, and the mac build is universal (Intel + Apple Silicon).
  darwin: { flag: ['--mac'], artifact: /^Blab-.*\.dmg$/ },
  win32: { flag: ['--win', 'nsis'], artifact: /^Blab-Setup-.*\.exe$/ },
  // One file that runs on any distribution, with nothing to install and no
  // package manager to argue with — the closest Linux has to what the dmg and
  // the exe already are.
  linux: { flag: ['--linux', 'AppImage'], artifact: /^Blab-.*\.AppImage$/ },
};

const TARGET = TARGETS[process.platform];
if (!TARGET) {
  console.error(`No installer target for ${process.platform}. Supported: ${Object.keys(TARGETS).join(', ')}.`);
  process.exit(1);
}

function run() {
  return new Promise((resolve, reject) => {
    // --publish never, because this script builds an installer and puts it in a
    // folder. It has never had anything to do with releasing one.
    //
    // Left to itself electron-builder disagrees: on any commit that carries a
    // git tag it decides the build must be a release, goes looking for a GitHub
    // token, and fails the whole run when there is none — after both installers
    // have already been written. Which is a strange way to lose a build that
    // worked, and stranger still on a laptop that was never going to publish
    // anything.
    const args = [...TARGET.flag, '--publish', 'never', `-c.directories.output=${out}`].map(quote);
    const child = spawn(quote(BUILDER), args, { cwd: ROOT, stdio: 'inherit', shell: WINDOWS });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`electron-builder exited ${code}`))));
  });
}

try {
  await run();

  const names = (await readdir(out)).filter((n) => TARGET.artifact.test(n));
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
