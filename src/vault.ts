// Everything the app knows about disk. A recording is a folder named
// `YYYY-MM-DD_HHMM_title-slug` holding audio.webm, notes.md and transcript.md.
export const AUDIO = 'audio.webm';
export const NOTES = 'notes.md';
export const TRANSCRIPT = 'transcript.md';

const DIR_PATTERN = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})_(.+)$/;

export type Recording = {
  /** Folder name on disk — also the id we pass around. */
  dir: string;
  title: string;
  when: Date;
};

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    // drop the combining accents NFKD split off, so "é" slugs to "e" not "e-"
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'untitled';
}

function unslugify(slug: string): string {
  const words = slug.replace(/-+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function folderName(title: string, at: Date): string {
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `${date}_${time}_${slugify(title)}`;
}

export function parseDir(dir: string): Recording | null {
  const m = DIR_PATTERN.exec(dir);
  if (!m) return null;
  const [, y, mo, d, h, mi, slug] = m;
  return {
    dir,
    title: unslugify(slug),
    when: new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi)),
  };
}

export async function pickRoot(): Promise<FileSystemDirectoryHandle> {
  return window.showDirectoryPicker({ id: 'blab', mode: 'readwrite', startIn: 'documents' });
}

/** True when we may read and write. Prompts the user if the grant has lapsed. */
export async function ensureAccess(root: FileSystemDirectoryHandle, prompt: boolean): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  if ((await root.queryPermission?.(opts)) === 'granted') return true;
  if (!prompt) return false;
  return (await root.requestPermission?.(opts)) === 'granted';
}

export async function listRecordings(root: FileSystemDirectoryHandle): Promise<Recording[]> {
  const found: Recording[] = [];
  for await (const entry of root.values()) {
    if (entry.kind !== 'directory') continue;
    const rec = parseDir(entry.name);
    if (rec) found.push(rec);
  }
  // Newest first. Folder names only carry minutes, so two recordings in the
  // same minute tie — fall back to the name, which sorts the "-2" collision
  // suffix (the later one) above the original.
  return found.sort(
    (a, b) => b.when.getTime() - a.when.getTime() || b.dir.localeCompare(a.dir),
  );
}

/** Makes the folder for a new recording, dodging any name already taken. */
export async function createRecordingDir(
  root: FileSystemDirectoryHandle,
  title: string,
  at: Date,
): Promise<{ dir: string; handle: FileSystemDirectoryHandle }> {
  const base = folderName(title, at);
  let name = base;
  for (let n = 2; await exists(root, name); n++) name = `${base}-${n}`;
  return { dir: name, handle: await root.getDirectoryHandle(name, { create: true }) };
}

async function exists(root: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await root.getDirectoryHandle(name);
    return true;
  } catch {
    return false;
  }
}

export async function write(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: Blob | string,
): Promise<void> {
  const file = await dir.getFileHandle(name, { create: true });
  const stream = await file.createWritable();
  await stream.write(data);
  await stream.close();
}

/** Null when the file is not there — a recording may have no transcript yet. */
export async function readFile(dir: FileSystemDirectoryHandle, name: string): Promise<File | null> {
  try {
    return await (await dir.getFileHandle(name)).getFile();
  } catch {
    return null;
  }
}

export async function readText(dir: FileSystemDirectoryHandle, name: string): Promise<string | null> {
  const file = await readFile(dir, name);
  return file ? file.text() : null;
}
