import './style.css';
import { decodeForWhisper } from './audio';
import { Recorder, formatDuration } from './recorder';
import { recallRoot, rememberRoot } from './store';
import { ModelMissingError, Transcriber } from './transcriber';
import {
  AUDIO,
  NOTES,
  TRANSCRIPT,
  type Recording,
  createRecordingDir,
  ensureAccess,
  listRecordings,
  pickRoot,
  readFile,
  readText,
  write,
} from './vault';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const ui = {
  setup: $('setup'),
  setupPick: $<HTMLButtonElement>('setup-pick'),
  pickFolder: $<HTMLButtonElement>('pick-folder'),
  folderName: $('folder-name'),
  recorder: $('recorder'),
  title: $<HTMLInputElement>('title'),
  record: $<HTMLButtonElement>('record'),
  timer: $('timer'),
  notes: $<HTMLTextAreaElement>('notes'),
  status: $('status'),
  micSettings: $<HTMLButtonElement>('mic-settings'),
  library: $('library'),
  list: $<HTMLUListElement>('list'),
  empty: $('empty'),
  detail: $('detail'),
};

const recorder = new Recorder();
const transcriber = new Transcriber();
/** Only macOS has a pane to send anyone to, so only there is the button worth offering. */
let canOpenMicSettings = false;
void window.blab?.micStatus().then((s) => (canOpenMicSettings = s !== 'unsupported'));
let root: FileSystemDirectoryHandle | null = null;
let recordings: Recording[] = [];
let selected: string | null = null;
let startedAt = 0;
let ticker: number | undefined;
/** Object URL for the audio player in the detail panel. Revoked on switch. */
let audioUrl: string | null = null;

function say(message: string, isError = false, offerMicSettings = false): void {
  ui.status.textContent = message;
  ui.status.classList.toggle('error', isError);
  ui.micSettings.classList.toggle('hidden', !offerMicSettings);
}

// ---------------------------------------------------------------- folder

async function connect(handle: FileSystemDirectoryHandle, prompt: boolean): Promise<boolean> {
  if (!(await ensureAccess(handle, prompt))) return false;
  root = handle;
  await rememberRoot(handle);
  ui.folderName.textContent = handle.name;
  ui.pickFolder.textContent = 'Change folder';
  ui.setup.classList.add('hidden');
  ui.recorder.classList.remove('hidden');
  ui.library.classList.remove('hidden');
  closeDetail();
  await refreshList();
  say(
    recordings.length
      ? `Using ${handle.name}. Type a title and press Record.`
      : `Using ${handle.name}. Type a title and press Record — Blab makes the folder for you.`,
  );
  return true;
}

async function choose(): Promise<void> {
  try {
    if (!(await connect(await pickRoot(), true))) {
      say('Blab cannot write to that folder yet. Pick it again and choose Allow.', true);
    }
  } catch (err) {
    // An abort just means they closed the picker.
    if ((err as DOMException)?.name !== 'AbortError') {
      say(`Could not open that folder: ${(err as Error).message}`, true);
    }
  }
}

// ---------------------------------------------------------------- list

async function refreshList(): Promise<void> {
  if (!root) return;
  recordings = await listRecordings(root);
  ui.list.replaceChildren(...recordings.map(row));
  ui.empty.classList.toggle('hidden', recordings.length > 0);
}

function row(rec: Recording): HTMLLIElement {
  const li = document.createElement('li');
  const button = document.createElement('button');
  button.classList.toggle('selected', rec.dir === selected);

  const title = document.createElement('span');
  title.textContent = rec.title;
  const when = document.createElement('span');
  when.className = 'when';
  when.textContent = rec.when.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  button.append(title, when);
  button.addEventListener('click', () => void open(rec));
  li.append(button);
  return li;
}

// ---------------------------------------------------------------- detail

function closeDetail(): void {
  selected = null;
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = null;
  ui.detail.replaceChildren();
  ui.detail.classList.add('hidden');
}

async function open(rec: Recording): Promise<void> {
  if (!root) return;
  if (selected === rec.dir) {
    closeDetail();
    await refreshList();
    return;
  }
  closeDetail();
  selected = rec.dir;

  const dir = await root.getDirectoryHandle(rec.dir);
  const [notes, transcript, audio] = await Promise.all([
    readText(dir, NOTES),
    readText(dir, TRANSCRIPT),
    readFile(dir, AUDIO),
  ]);

  const heading = document.createElement('h3');
  heading.textContent = rec.title;
  ui.detail.append(heading);

  if (audio) {
    audioUrl = URL.createObjectURL(audio);
    const player = document.createElement('audio');
    player.controls = true;
    player.src = audioUrl;
    ui.detail.append(player);
  }

  ui.detail.append(
    block('Your notes', notes, 'You did not write any notes.'),
    block('Transcript', transcript, 'No transcript yet.'),
    actions(rec, dir, notes, transcript),
  );
  ui.detail.classList.remove('hidden');
  await refreshList();
}

function actions(
  rec: Recording,
  dir: FileSystemDirectoryHandle,
  notes: string | null,
  transcript: string | null,
): HTMLDivElement {
  const bar = document.createElement('div');
  bar.className = 'row';

  const copy = document.createElement('button');
  copy.textContent = 'Copy all';
  copy.addEventListener('click', async () => {
    if (await copyToClipboard(asOneBlock(rec, notes, transcript))) {
      copy.textContent = 'Copied';
      setTimeout(() => (copy.textContent = 'Copy all'), 1500);
    } else {
      say('Could not reach the clipboard. Click the page once, then try again.', true);
    }
  });
  bar.append(copy);

  // Only shown when a recording never got its transcript — usually because the
  // model was not set up yet at the time.
  if (!transcript?.trim()) {
    const retry = document.createElement('button');
    retry.textContent = 'Transcribe';
    retry.addEventListener('click', () => {
      retry.disabled = true;
      void transcribeInto(dir, rec.dir).finally(() => (retry.disabled = false));
    });
    bar.append(retry);
  }
  return bar;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // The clipboard API refuses when the page has not been clicked recently.
    // execCommand is deprecated but it is the only other way, and losing the
    // one button that gets your notes into an AI is not an option.
    const scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.append(scratch);
    scratch.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      scratch.remove();
    }
  }
}

/** One clean text block, ready to paste into an AI. */
function asOneBlock(rec: Recording, notes: string | null, transcript: string | null): string {
  return [
    `# ${rec.title}`,
    rec.when.toLocaleString(),
    '',
    '## My notes',
    notes?.trim() || '(none)',
    '',
    '## Transcript',
    transcript?.trim() || '(none)',
    '',
  ].join('\n');
}

function block(label: string, text: string | null, fallback: string): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'block';
  const h4 = document.createElement('h4');
  h4.textContent = label;
  const pre = document.createElement('pre');
  const body = text?.trim();
  pre.textContent = body || fallback;
  pre.classList.toggle('empty', !body);
  wrap.append(h4, pre);
  return wrap;
}

// ---------------------------------------------------------------- recording

function tick(): void {
  ui.timer.textContent = formatDuration(Date.now() - startedAt);
}

/**
 * macOS hands back a stream of silence when it has never been asked, so asking
 * has to happen before the recorder opens rather than in reply to an error that
 * never arrives. Returns false when there is no point going on.
 */
async function microphoneReady(): Promise<boolean> {
  if (!window.blab) return true;
  if (await window.blab.requestMic()) return true;
  // Reached only after the prompt has been answered no once. macOS will not
  // show it a second time, so the pane is the only way back.
  say('Blab needs the microphone. Switch Blab on below, then press Record again.', true, true);
  return false;
}

async function startRecording(): Promise<void> {
  if (!(await microphoneReady())) return;
  try {
    await recorder.start();
  } catch (err) {
    const name = (err as DOMException)?.name;
    say(
      name === 'NotAllowedError'
        ? 'Blab needs the microphone. Turn it on for Blab, then press Record again.'
        : name === 'NotFoundError'
          ? 'No microphone found. Plug one in and press Record again.'
          : `Could not start the microphone: ${(err as Error).message}`,
      true,
      name === 'NotAllowedError' && canOpenMicSettings,
    );
    return;
  }
  startedAt = Date.now();
  tick();
  ticker = window.setInterval(tick, 250);
  ui.record.textContent = 'Stop';
  ui.record.classList.add('is-recording');
  ui.timer.classList.add('live');
  ui.title.disabled = true;
  say('Recording. Type your notes as you listen.');
}

async function stopRecording(): Promise<void> {
  window.clearInterval(ticker);
  ui.timer.classList.remove('live');
  ui.record.disabled = true;
  ui.record.textContent = 'Record';
  ui.record.classList.remove('is-recording');

  const audio = await recorder.stop();
  const notes = ui.notes.value;
  const title = ui.title.value.trim() || 'Untitled';

  let saved: { dir: string; handle: FileSystemDirectoryHandle } | null = null;
  try {
    if (!root) throw new Error('No folder connected.');
    saved = await createRecordingDir(root, title, new Date());
    await write(saved.handle, AUDIO, audio);
    await write(saved.handle, NOTES, notes);
    say(`Saved to ${saved.dir}.`);
    ui.title.value = '';
    ui.notes.value = '';
    ui.timer.textContent = '00:00';
    await refreshList();
  } catch (err) {
    say(`Could not save: ${(err as Error).message}`, true);
  } finally {
    ui.record.disabled = false;
    ui.title.disabled = false;
  }

  // The audio and notes are already on disk, so a transcription problem from
  // here on costs the user nothing.
  if (saved) await transcribeInto(saved.handle, saved.dir);
}

async function transcribeInto(dir: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    const audio = await readFile(dir, AUDIO);
    if (!audio) throw new Error(`No ${AUDIO} in ${name}.`);

    say('Reading the audio…');
    const samples = await decodeForWhisper(audio);

    const text = await transcriber.transcribe(samples, (p) => {
      if (p.stage === 'loading') return say('Starting Whisper on this machine…');
      say(
        p.total > 1
          ? `Transcribing on this machine — part ${Math.max(p.done, 1)} of ${p.total}.`
          : 'Transcribing on this machine…',
      );
    });

    await write(dir, TRANSCRIPT, text);
    say(`Transcript saved to ${name}/${TRANSCRIPT}.`);
    await reopenIfShowing(name);
  } catch (err) {
    if (err instanceof ModelMissingError) {
      say(
        'Whisper is not set up yet. Run `npm run setup` once with internet, reload, ' +
          `then press Transcribe. Your audio and notes are safe in ${name}.`,
        true,
      );
    } else {
      say(`Could not transcribe (audio and notes are saved): ${(err as Error).message}`, true);
    }
  }
}

/** Refreshes the detail panel if the recording that just changed is open. */
async function reopenIfShowing(name: string): Promise<void> {
  const rec = recordings.find((r) => r.dir === name);
  if (!rec || selected !== name) return;
  selected = null; // force open() to rebuild rather than toggle shut
  await open(rec);
}

// ---------------------------------------------------------------- boot

/** A folder we remember but have not been re-granted access to yet. */
let pending: FileSystemDirectoryHandle | null = null;

async function setupPickClicked(): Promise<void> {
  const saved = pending;
  pending = null;
  ui.setupPick.textContent = 'Pick a folder';
  // Re-granting a remembered folder is one click; if they say no, let them
  // pick a different one.
  if (saved && (await connect(saved, true))) return;
  await choose();
}

ui.micSettings.addEventListener('click', () => {
  void window.blab?.openMicSettings();
});

ui.record.addEventListener('click', () => {
  void (recorder.active ? stopRecording() : startRecording());
});
ui.pickFolder.addEventListener('click', () => void choose());
ui.setupPick.addEventListener('click', () => void setupPickClicked());

async function boot(): Promise<void> {
  if (!('showDirectoryPicker' in window)) {
    ui.setup.classList.remove('hidden');
    ui.setupPick.disabled = true;
    say('Blab needs Chrome or Edge — other browsers cannot write to a folder you pick.', true);
    return;
  }
  const saved = await recallRoot();
  // A remembered folder still needs the user to re-grant it, and the browser
  // only allows that from a click. So we show the picker screen and wait.
  if (saved && (await connect(saved, false))) return;
  if (saved) {
    pending = saved;
    ui.setupPick.textContent = `Open ${saved.name}`;
  }
  ui.setup.classList.remove('hidden');
}

void boot();
