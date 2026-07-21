// electron-builder writes the installer next to a 400 MB scratch folder it
// also produces. Only the installer is worth finding, so it gets moved up to
// the project root where you cannot miss it.
import { readdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = path.join(ROOT, 'release');

const names = (await readdir(RELEASE)).filter((n) => /^Blab-Setup-.*\.exe$/.test(n));
if (names.length === 0) {
  console.error('No installer in release/ — electron-builder did not finish.');
  process.exit(1);
}

for (const name of names) {
  const to = path.join(ROOT, name);
  await rename(path.join(RELEASE, name), to);
  const { size } = await stat(to);
  console.log(`${name} is in the Blab folder — ${Math.round(size / 1e6)} MB. Double-click it.`);
}
