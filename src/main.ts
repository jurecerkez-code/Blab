import './style.css';
import { decodeForWhisper } from './audio';
import { type Scored, highlights, sentences } from './highlights';
import { Meter } from './meter';
import { NoteClock } from './notes';
import { Recorder, formatDuration } from './recorder';
import { forgetRoot, recallRoot, rememberRoot } from './store';
import { type Line, parse, render, stamp } from './timeline';
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
  repoAround,
  readFile,
  readText,
  saveAs,
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
  pause: $<HTMLButtonElement>('pause'),
  timer: $('timer'),
  meter: $('meter'),
  notes: $<HTMLTextAreaElement>('notes'),
  status: $('status'),
  micSettings: $<HTMLButtonElement>('mic-settings'),
  library: $('library'),
  list: $<HTMLUListElement>('list'),
  empty: $('empty'),
  detail: $('detail'),
};

const recorder = new Recorder();
const meter = new Meter(ui.meter);
const transcriber = new Transcriber();
const noteClock = new NoteClock();
/** Only macOS has a pane to send anyone to, so only there is the button worth offering. */
let canOpenMicSettings = false;
void window.blab?.micStatus().then((s) => (canOpenMicSettings = s !== 'unsupported'));
let root: FileSystemDirectoryHandle | null = null;
let recordings: Recording[] = [];
let selected: string | null = null;
let startedAt = 0;
/** Milliseconds banked from earlier stretches, before the current pause. */
let recorded = 0;
let ticker: number | undefined;
/** Object URL for the audio player in the detail panel. Revoked on switch. */
let audioUrl: string | null = null;

function say(message: string, isError = false, offerMicSettings = false): void {
  ui.status.textContent = message;
  ui.status.classList.toggle('error', isError);
  ui.micSettings.classList.toggle('hidden', !offerMicSettings);
}

// ---------------------------------------------------------------- folder

type Connected = 'ok' | 'no-access' | 'in-repo';

async function connect(handle: FileSystemDirectoryHandle, prompt: boolean): Promise<Connected> {
  if (!(await ensureAccess(handle, prompt))) return 'no-access';
  // Checked before anything is committed to, so a refusal leaves whatever
  // folder was already in use exactly where it was. Refused rather than warned
  // about: a warning puts the whole weight of it on somebody remembering, weeks
  // later on the day they happen to type `git add -A`, what a status line said
  // when they picked the folder.
  const repo = await repoAround(handle);
  if (repo) {
    say(
      `Blab will not record into ${repo}, a git repository — recordings there would sit in a working tree and could be committed and pushed. Pick a folder outside it.`,
      true,
    );
    return 'in-repo';
  }
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
  return 'ok';
}

async function choose(): Promise<void> {
  try {
    // 'in-repo' has already said why, and the picker is not reopened on top of
    // that message: it would hide the one sentence explaining what just failed.
    if ((await connect(await pickRoot(), true)) === 'no-access') {
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

  // The folder can be gone by the time it is clicked: renamed, deleted, or on
  // a drive that was unplugged since the list was drawn. Without this the
  // click does nothing whatsoever — the panel stays shut, no message appears,
  // and the rejection goes nowhere anyone can see.
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await root.getDirectoryHandle(rec.dir);
  } catch {
    selected = null;
    say(`${rec.dir} is not in ${root.name} any more. It may have been moved or deleted.`, true);
    await refreshList();
    return;
  }

  const [notes, transcript, audio] = await Promise.all([
    readText(dir, NOTES),
    readText(dir, TRANSCRIPT),
    readFile(dir, AUDIO),
  ]);

  const heading = document.createElement('h3');
  heading.textContent = rec.title;
  ui.detail.append(heading);

  let seek: ((ms: number) => void) | null = null;
  if (audio) {
    audioUrl = URL.createObjectURL(audio);
    const player = document.createElement('audio');
    player.controls = true;
    player.src = audioUrl;
    ui.detail.append(player);
    seek = (ms) => {
      player.currentTime = ms / 1000;
      void player.play();
    };
  }

  const view = read(notes, transcript);

  if (view.picks.length) {
    const why = 'Picked out of the words below. Nothing here was written by a machine.';
    ui.detail.append(timedBlock('Worth going back to', view.picks, seek, why));
  }
  ui.detail.append(
    view.noteLines
      ? timedBlock('Your notes', view.noteLines, seek)
      : block('Your notes', notes, 'You did not write any notes.'),
    view.timedScript
      ? timedBlock('Transcript', view.timedScript, seek)
      : block('Transcript', transcript, 'No transcript yet.'),
    actions(rec, dir, view, notes, transcript),
  );
  ui.detail.classList.remove('hidden');
  await refreshList();
}

/** Everything the detail panel shows, worked out from the two files on disk. */
type View = {
  /** Null for notes taken before Blab timed them — then they show as they are. */
  noteLines: Line[] | null;
  /** Null for a transcript saved before Blab timed it. */
  timedScript: Line[] | null;
  picks: Scored[];
};

function read(notes: string | null, transcript: string | null): View {
  const noteLines = notes?.trim() ? parse(notes) : null;
  const timedScript = transcript?.trim() ? parse(transcript) : null;
  // An untimed transcript still gets highlights, cut into sentences instead of
  // Whisper's phrases. They just have nowhere to jump to.
  const lines: Scored[] = timedScript ?? (transcript?.trim() ? sentences(transcript) : []);
  return {
    noteLines,
    timedScript,
    picks: highlights(
      lines,
      (noteLines ?? []).map((l) => l.at),
    ),
  };
}

function actions(
  rec: Recording,
  dir: FileSystemDirectoryHandle,
  view: View,
  notes: string | null,
  transcript: string | null,
): HTMLDivElement {
  const bar = document.createElement('div');
  bar.className = 'row';

  const copy = document.createElement('button');
  copy.textContent = 'Copy all';
  copy.addEventListener('click', async () => {
    if (await copyToClipboard(asOneBlock(rec, view, notes, transcript))) {
      copy.textContent = 'Copied';
      setTimeout(() => (copy.textContent = 'Copy all'), 1500);
    } else {
      say('Could not reach the clipboard. Click the page once, then try again.', true);
    }
  });
  bar.append(copy);

  // Copy all covers pasting it somewhere. This covers handing someone a file.
  bar.append(
    exportButton('Save .md', `${rec.dir}.md`, 'text/markdown', () =>
      asOneBlock(rec, view, notes, transcript),
    ),
    exportButton('Save .txt', `${rec.dir}.txt`, 'text/plain', () =>
      asPlainText(asOneBlock(rec, view, notes, transcript)),
    ),
  );

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

function exportButton(
  label: string,
  filename: string,
  mime: string,
  body: () => string,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = label;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      if (await saveAs(filename, body(), mime)) say(`Saved ${filename}.`);
    } catch (err) {
      say(`Could not save that copy: ${(err as Error).message}`, true);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

/**
 * One clean text block: everything about the recording, in order, ready to
 * paste into an AI or hand to someone. The full transcript is always in it —
 * the highlights sit above it rather than in place of it, because they are a
 * way in, not a replacement.
 */
function asOneBlock(
  rec: Recording,
  view: View,
  notes: string | null,
  transcript: string | null,
): string {
  const out = [`# ${rec.title}`, rec.when.toLocaleString(), ''];
  if (view.picks.length) {
    out.push(
      '## Worth going back to',
      ...view.picks.map((p) => (p.at == null ? `- ${p.text}` : `- ${stamp(p.at)}${p.text}`)),
      '',
    );
  }
  out.push(
    '## My notes',
    notes?.trim() || '(none)',
    '',
    '## Transcript',
    transcript?.trim() || '(none)',
    '',
  );
  return out.join('\n');
}

/** The same thing for anywhere that shows markdown as the characters it is. */
function asPlainText(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) => line.replace(/^#{1,6} /, '').replace(/^- /, '  '))
    .join('\n');
}

/**
 * Lines with the time each one belongs to. Click one and the player above jumps
 * there, which is the whole reason the times are kept: a two hour lecture is
 * unusable as a wall of text and fine as something you can land in the middle
 * of.
 */
function timedBlock(
  label: string,
  lines: Scored[],
  seek: ((ms: number) => void) | null,
  hint?: string,
): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'block';
  const h4 = document.createElement('h4');
  h4.textContent = label;
  wrap.append(h4);

  if (hint) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = hint;
    wrap.append(p);
  }

  const list = document.createElement('div');
  list.className = 'timed';
  for (const line of lines) {
    const at = line.at;
    // Nothing to jump to without both a time and a player, and a button that
    // does nothing is worse than a plain line.
    const clickable = seek !== null && at !== null;
    const row = document.createElement(clickable ? 'button' : 'div');
    row.className = 'line';
    if (at !== null) {
      const when = document.createElement('span');
      when.className = 'at';
      when.textContent = formatDuration(at);
      row.append(when);
    }
    const said = document.createElement('span');
    said.className = 'said';
    said.textContent = line.text;
    row.append(said);
    if (clickable) {
      row.title = 'Play from here';
      row.addEventListener('click', () => seek(at));
    }
    list.append(row);
  }

  wrap.append(list);
  return wrap;
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

/**
 * Time actually recorded, which is not the time since Record was pressed: a
 * break in the middle of a lecture should not show up as an hour of talk that
 * is not in the file.
 */
function recordedMs(): number {
  return recorded + (recorder.paused ? 0 : Date.now() - startedAt);
}

function tick(): void {
  ui.timer.textContent = formatDuration(recordedMs());
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
  // From here the shell holds the machine awake and asks before any close
  // throws the take away. Both stop again in the finally of stopRecording.
  window.blab?.setRecording(true);

  const stream = recorder.mediaStream;
  if (stream) await meter.start(stream);

  startedAt = Date.now();
  recorded = 0;
  noteClock.reset(ui.notes.value);
  tick();
  ticker = window.setInterval(tick, 250);
  ui.record.textContent = 'Stop';
  ui.record.classList.add('is-recording');
  ui.timer.classList.add('live');
  ui.pause.textContent = 'Pause';
  ui.pause.classList.remove('hidden');
  ui.title.disabled = true;
  say('Recording. Type your notes as you listen.');
}

/**
 * A break between lectures should not become a second recording. Pausing keeps
 * the microphone open and the file open, and writes nothing in between.
 */
async function togglePause(): Promise<void> {
  if (!recorder.active) return;

  if (recorder.paused) {
    recorder.resume();
    startedAt = Date.now();
    ticker = window.setInterval(tick, 250);
    // A fresh meter on the same stream; the old one released its audio device
    // when we paused.
    const stream = recorder.mediaStream;
    if (stream) await meter.start(stream);
    ui.pause.textContent = 'Pause';
    ui.timer.classList.add('live');
    ui.record.classList.add('is-recording');
    say('Recording. Type your notes as you listen.');
    return;
  }

  recorder.pause();
  recorded += Date.now() - startedAt;
  window.clearInterval(ticker);
  tick();
  // Flat bars while paused, which is the truth: nothing is being captured.
  meter.stop();
  ui.pause.textContent = 'Resume';
  ui.timer.classList.remove('live');
  ui.record.classList.remove('is-recording');
  say('Paused. Nothing is being recorded. Press Resume to carry on.');
}

async function stopRecording(): Promise<void> {
  window.clearInterval(ticker);
  ui.pause.classList.add('hidden');
  // Before recorder.stop(), so the meter lets go of the stream while it is
  // still alive rather than reading a track that is already ending.
  meter.stop();
  ui.timer.classList.remove('live');
  ui.record.disabled = true;
  ui.record.textContent = 'Record';
  ui.record.classList.remove('is-recording');

  let saved: { dir: string; handle: FileSystemDirectoryHandle } | null = null;
  try {
    // Inside the try along with everything else. Left outside it, a recorder
    // that refused to stop took the finally down with it and left Record
    // disabled for good — the one failure that needs the button most.
    const audio = await recorder.stop();
    // Each line goes to disk with the moment it was typed in front of it, so
    // the notes and the transcript end up on one time axis.
    const notes = noteClock.render(ui.notes.value);
    const title = ui.title.value.trim() || 'Untitled';

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
    // Whatever happened above, nothing is recording now: the shell can let the
    // machine sleep again and stop guarding the close button.
    window.blab?.setRecording(false);
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

    const result = await transcriber.transcribe(samples, (p) => {
      if (p.stage === 'loading') return say('Starting Whisper on this machine…');
      say(
        p.total > 1
          ? `Transcribing on this machine — part ${Math.max(p.done, 1)} of ${p.total}.`
          : 'Transcribing on this machine…',
      );
    });

    // One line per phrase, each with the second it was said at. Whisper hands
    // the times over as part of the same generation, so this costs nothing and
    // is what lets a line be clicked.
    //
    // The times are the feature; the words are the point. If the timed version
    // has lost any of them the plain text goes to disk instead, and a talk you
    // cannot click beats a talk that is missing its last two minutes.
    const timed = render(result.segments);
    await write(dir, TRANSCRIPT, keptEverything(timed, result.text) ? timed : result.text);
    // Saved either way. A transcript that is mostly Whisper talking to itself is
    // still the only record of that talk, and deleting it would be the app
    // deciding something it cannot know. Saying so is the whole fix: the failure
    // used to be invisible until someone read two thousand words of "ti ki pi".
    if (result.degenerate) {
      say(
        `Saved to ${name}/${TRANSCRIPT}, but it looks like Whisper got stuck repeating ` +
          'itself rather than transcribing. That means it could not hear speech clearly — ' +
          'get the microphone closer and record again.',
        true,
      );
    } else {
      say(`Transcript saved to ${name}/${TRANSCRIPT}.`);
    }
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

/**
 * True when the timed transcript still holds every word the plain one does.
 *
 * Compared as words with the times taken back off, because the two differ in
 * whitespace and line breaks by design and neither of those is a word. Empty
 * segments mean the pipeline returned no times at all, which is a fall back
 * rather than a loss.
 */
function keptEverything(timed: string, plain: string): boolean {
  const words = (s: string) => s.replace(/\[[\d:]+\]/g, ' ').split(/\s+/).filter(Boolean);
  return timed.trim().length > 0 && words(timed).length >= words(plain).length;
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
  if (saved && (await connect(saved, true)) === 'ok') return;
  await choose();
}

ui.micSettings.addEventListener('click', () => {
  void window.blab?.openMicSettings();
});

ui.record.addEventListener('click', () => {
  void (recorder.active ? stopRecording() : startRecording());
});
ui.pause.addEventListener('click', () => void togglePause());
// Typing is the only place a note's time can come from, and it has to be read
// here rather than at Stop: by then every line looks the same age.
ui.notes.addEventListener('input', () => {
  if (!recorder.active) return;
  noteClock.mark(ui.notes.value, ui.notes.selectionStart ?? ui.notes.value.length, recordedMs());
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
  if (saved) {
    const status = await connect(saved, false);
    if (status === 'ok') return;
    if (status === 'in-repo') {
      // Remembered from a version that allowed it. It will be refused every
      // time from here, so it is dropped rather than offered again — and the
      // message connect() left on screen says why.
      await forgetRoot();
    } else {
      // A remembered folder still needs the user to re-grant it, and the
      // browser only allows that from a click. Show the picker screen and wait.
      pending = saved;
      ui.setupPick.textContent = `Open ${saved.name}`;
    }
  }
  ui.setup.classList.remove('hidden');
}

void boot();
