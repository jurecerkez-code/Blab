// Renders build/icon.ico from an inline SVG. Run once; the file is committed
// by whoever runs it. Windows needs a real .ico, and a 256px PNG inside an ICO
// container is the whole format — hence the 22 bytes of header below.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'build', 'icon.ico');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="56" fill="#14140f"/>
  <path d="M128 52c-42 0-76 27-76 60 0 19 11 36 29 47l-9 33c-1 5 4 8 8 5l38-25a99 99 0 0 0 10 .5c42 0 76-27 76-60s-34-60-76-60z" fill="#ffb454"/>
  <circle cx="128" cy="112" r="26" fill="#14140f"/>
</svg>`;

async function main() {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.error('sharp is not installed — skipping the icon. The app will use the default one.');
    return;
  }

  const png = await sharp(Buffer.from(SVG)).resize(256, 256).png().toBuffer();

  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(1, 4); // one image
  header.writeUInt8(0, 6); // width 0 means 256
  header.writeUInt8(0, 7); // height 0 means 256
  header.writeUInt8(0, 8); // palette size
  header.writeUInt8(0, 9); // reserved
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18);

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, Buffer.concat([header, png]));
  console.log(`Wrote ${path.relative(ROOT, OUT)} (${png.length} bytes of PNG).`);
}

await main();
