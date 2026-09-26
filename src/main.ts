import './style.css';
import { decodeForWhisper } from './audio';
import { type Scored, highlights, sentences } from './highlights';
import { LiveCaptions } from './live-captions';
import { Meter } from './meter';
import { MODELS, modelById, savedModel, saveModel, savedSystemCapture, saveSystemCapture, suggestedModel, type ModelId } from './models';
import { NoteClock } from './notes';
import { Recorder, formatDuration } from './recorder';
import { forgetRoot, recallRoot, rememberRoot } from './store';
import { type Line, parse, plainText, render, stamp, toSrt, toVtt } from './timeline';
import { ModelMissingError, OutOfMemoryError, Transcriber } from './transcriber';
import {
  AUDIO,
  NOTES,
  TRANSCRIPT,
  type Recording,
  createRecordingDir,
  ensureAccess,
  findAudio,
  importAudio,
  listRecordings,
  pickRoot,
  repoAround,
  readText,
  saveAs,
  write,
  writeAtomic,
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
  model: $<HTMLSelectElement>('model'),
  meeting: $<HTMLInputElement>('meeting'),
  captions: $('captions'),
  importBtn: $<HTMLButtonElement>('import'),
  importFile: $<HTMLInputElement>('import-file'),
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
/** The keyboard handler the detail panel installed; removed when it closes. */
let playerKeys: ((e: KeyboardEvent) => void) | null = null;

const captions = new LiveCaptions(ui.captions, (audio, at) => {
  transcriber.live(audio, savedModel(), at, (text, atTime) => {
    if (text) captions.show(text, atTime, formatDuration);
  });
});

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
      `Blab will not record into ${repo}, a git repository. Recordings there would sit in a working tree and could be committed and pushed. Pick a folder outside it.`,
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
  await refreshModelOptions();
  say(
    recordings.length
      ? `Using ${handle.name}. Type a title and press Record.`
      : `Using ${handle.name}. Type a title and press Record; Blab makes the folder for you.`,
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

// ---------------------------------------------------------------- model

async function modelInstalled(repo: string): Promise<boolean> {
  try {
    // Both halves matter. A download that stops halfway leaves the encoder
    // present and the decoder missing, and a picker that claims the model is
    // ready while transcription would fail is a picker that lies.
    const names = ['encoder_model_quantized.onnx', 'decoder_model_merged_quantized.onnx'];
    const results = await Promise.all(
      names.map(async (name) => {
        const r = await fetch(`models/${repo}/onnx/${name}`, { method: 'HEAD' });
        return (
          r.ok &&
          !(r.headers.get('content-type') ?? '').includes('text/html') &&
          Number(r.headers.get('content-length')) > 1_000_000
        );
      }),
    );
    return results.every(Boolean);
  } catch {
    return false;
  }
}

/** Fills the model picker with what setup actually installed. */
async function refreshModelOptions(): Promise<void> {
  ui.model.replaceChildren();
  for (const m of MODELS) {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = (await modelInstalled(m.repo))
      ? `${m.label} (${m.hint})`
      : `${m.label} (${m.hint}). Not installed. Run npm run setup ${m.id}.`;
    ui.model.append(opt);
  }
  ui.model.value = savedModel();
}

ui.model.addEventListener('change', () => {
  const m = modelById(ui.model.value as ModelId);
  saveModel(m.id);
  say(`Transcribing with the ${m.label.toLowerCase()} model.`);
});

ui.meeting.addEventListener('change', () => {
  saveSystemCapture(ui.meeting.checked);
  say(ui.meeting.checked ? 'Computer audio will be recorded too.' : 'Microphone only.');
});

// ---------------------------------------------------------------- import

ui.importBtn.addEventListener('click', () => ui.importFile.click());
ui.importFile.addEventListener('change', async () => {
  const file = ui.importFile.files?.[0];
  ui.importFile.value = '';
  if (!file || !root) return;
  try {
    const dir = await importAudio(root, file, file.name, new Date(file.lastModified ?? Date.now()));
    say(`Imported ${file.name}. Transcribing on this machine…`);
    await refreshList();
    const rec = recordings.find((r) => r.dir === dir);
    if (rec) await open(rec);
    const handle = await root.getDirectoryHandle(dir);
    await transcribeInto(handle, dir);
  } catch (err) {
    say(`Could not import that file: ${(err as Error).message}`, true);
  }
});

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
  if (playerKeys) {
    window.removeEventListener('keydown', playerKeys);
    playerKeys = null;
  }
  ui.detail.replaceChildren();
  ui.detail.classList.add('hidden');
}

function installPlayerKeys(player: HTMLAudioElement): void {
  playerKeys = (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT')) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (player.paused) void player.play();
      else player.pause();
    } else if (e.key === 'ArrowLeft') {
      player.currentTime = Math.max(0, player.currentTime - 5);
    } else if (e.key === 'ArrowRight') {
      player.currentTime = Math.min(player.duration || Infinity, player.currentTime + 5);
    } else if (e.key === 'ArrowUp') {
      player.currentTime = Math.min(player.duration || Infinity, player.currentTime + 30);
    } else if (e.key === 'ArrowDown') {
      player.currentTime = Math.max(0, player.currentTime - 30);
    }
  };
  window.addEventListener('keydown', playerKeys);
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
  // click does nothing whatsoever; the panel stays shut, no message appears,
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

  const [notes, transcript, audioFile] = await Promise.all([
    readText(dir, NOTES),
    readText(dir, TRANSCRIPT),
    findAudio(dir),
  ]);

  const heading = document.createElement('h3');
  heading.textContent = rec.title;
  ui.detail.append(heading);

  let seek: ((ms: number) => void) | null = null;
  if (audioFile) {
    const audio = await audioFile.handle.getFile();
    audioUrl = URL.createObjectURL(audio);
    const playerRow = document.createElement('div');
    playerRow.className = 'row';
    const player = document.createElement('audio');
    player.controls = true;
    player.src = audioUrl;
    playerRow.append(player);
    const speed = document.createElement('select');
    speed.className = 'speed';
    speed.title = 'Playback speed';
    speed.setAttribute('aria-label', 'Playback speed');
    for (const v of ['0.5', '0.75', '1', '1.25', '1.5', '2']) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v + '×';
      speed.append(opt);
    }
    speed.value = '1';
    speed.addEventListener('change', () => {
      player.playbackRate = Number(speed.value);
    });
    playerRow.append(speed);
    ui.detail.append(playerRow);
    installPlayerKeys(player);
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
      ? timedBlock('Transcript', view.timedScript, seek, undefined, 'hide')
      : block('Transcript', transcript, 'No transcript yet.'),
    actions(rec, dir, view, notes, transcript),
  );
  ui.detail.classList.remove('hidden');
  await refreshList();
}

/** Everything the detail panel shows, worked out from the two files on disk. */
type View = {
  /** Null for notes taken before Blab timed them; then they show as they are. */
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
  bar.className = 'row wrap';

  const copy = document.createElement('button');
  copy.textContent = 'Copy all';
  copy.addEventListener('click', async () => {
    // Copy all means the words and nothing else: pure text, no stamps, no
    // headings. The stamped version stays available through Save .md.
    const text = transcript?.trim() ? plainText(transcript) : notes?.trim() || '';
    if (!text) {
      say('Nothing to copy yet. Record and transcribe first.', true);
      return;
    }
    if (await copyToClipboard(text)) {
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

  // Subtitles are the transcript with the times kept, so they only exist for
  // recordings whose transcript carries times.
  if (view.timedScript) {
    bar.append(
      exportButton('Save .srt', `${rec.dir}.srt`, 'application/x-subrip', () => toSrt(view.timedScript!)),
      exportButton('Save .vtt', `${rec.dir}.vtt`, 'text/vtt', () => toVtt(view.timedScript!)),
    );
  }

  // Transcribe is always offered: first time for a recording that never got
  // its transcript, and from then on as a way to redo it; normally with a
  // better model, which is exactly the loop the model picker is for. The
  // picker's current model decides; the old transcript.md is overwritten.
  const transcribe = document.createElement('button');
  transcribe.textContent = transcript?.trim() ? 'Re-transcribe' : 'Transcribe';
  transcribe.addEventListener('click', () => {
    const before = transcribe.disabled;
    transcribe.disabled = true;
    void transcribeInto(dir, rec.dir).finally(() => (transcribe.disabled = before));
  });
  bar.append(transcribe);
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
 * paste into an AI or hand to someone. The full transcript is always in it , 
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
    transcript?.trim() ? plainText(transcript) : '(none)',
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
  times: 'show' | 'hide' = 'show',
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
    // does nothing is worse than a plain line. The transcript keeps its times
    // for clicking; the stamp is only hidden from view.
    const clickable = seek !== null && at !== null;
    const row = document.createElement(clickable ? 'button' : 'div');
    row.className = 'line';
    if (at !== null && times === 'show') {
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
    await recorder.start({
      captureSystem: ui.meeting.checked,
      onSystemWarning: (m) => say(m, true),
    });
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
  if (stream) {
    await meter.start(stream);
    await captions.start(stream, () => recordedMs());
  }

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
  ui.model.disabled = true;
  ui.meeting.disabled = true;
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
    if (stream) {
      await meter.start(stream);
      // The captions' capture also died with the pause; restart it too.
      await captions.start(stream, () => recordedMs());
    }
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
  captions.stop();
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
  captions.stop();
  ui.timer.classList.remove('live');
  ui.record.disabled = true;
  ui.record.textContent = 'Record';
  ui.record.classList.remove('is-recording');

  let saved: { dir: string; handle: FileSystemDirectoryHandle } | null = null;
  try {
    // Inside the try along with everything else. Left outside it, a recorder
    // that refused to stop took the finally down with it and left Record
    // disabled for good; the one failure that needs the button most.
    const audio = await recorder.stop();
    // The recorder noticed a quiet system capture; say so while the people
    // who just recorded a meeting can still do something about it.
    for (const warning of recorder.warnings) say(warning, true);
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
    ui.model.disabled = false;
    // Not a plain `false`: on a machine with no loopback device this checkbox
    // was disabled at boot and has to stay that way, or the first recording
    // would quietly hand it back.
    ui.meeting.disabled = Boolean(window.blab) && !window.blab?.device?.systemAudio;
  }

  // The audio and notes are already on disk, so a transcription problem from
  // here on costs the user nothing.
  if (saved) await transcribeInto(saved.handle, saved.dir);
}

async function transcribeInto(
  dir: FileSystemDirectoryHandle,
  name: string,
  model: ModelId = savedModel(),
  allowFallback = true,
): Promise<void> {
  try {
    const audioFile = await findAudio(dir);
    if (!audioFile) throw new Error(`No audio in ${name}.`);
    const audio = await audioFile.handle.getFile();

    say('Reading the audio…');
    const samples = await decodeForWhisper(audio);

    // The transcript is written as it comes, so a crash mid-run costs nothing
    // more than the last few chunks. The timed version replaces it at the end.
    const result = await transcriber.transcribe(
      samples,
      model,
      (p) => {
        if (p.stage === 'loading') return say('Starting Whisper on this machine…');
        say(
          p.total > 1
            ? `Transcribing on this machine. Part ${Math.max(p.done, 1)} of ${p.total}.`
            : 'Transcribing on this machine…',
        );
      },
      (text) => {
        if (text) void writeAtomic(dir, TRANSCRIPT, text).catch(() => {});
      },
    );

    // Not fatal — the transcript is complete either way — but silence
    // skipping is a headline of this app and it failing quietly is how it
    // came to be broken in every build from 0.7.0 on without anyone noticing.
    if (result.vadFailed) {
      say('The silence detector could not run, so the whole recording was transcribed.', true);
    }

    if (result.noSpeech) {
      say('No speech found in the recording, so nothing was transcribed.');
      return;
    }

    // One line per phrase, each with the second it was said at. Whisper hands
    // the times over as part of the same generation, so this costs nothing and
    // is what lets a line be clicked.
    //
    // The times are the feature; the words are the point. If the timed version
    // has lost any of them the plain text goes to disk instead, and a talk you
    // cannot click beats a talk that is missing its last two minutes.
    const timed = render(result.segments);
    await writeAtomic(dir, TRANSCRIPT, keptEverything(timed, result.text) ? timed : result.text);
    // Saved either way. A transcript that is mostly Whisper talking to itself is
    // still the only record of that talk, and deleting it would be the app
    // deciding something it cannot know. Saying so is the whole fix: the failure
    // used to be invisible until someone read two thousand words of "ti ki pi".
    if (result.degenerate) {
      say(
        `Saved to ${name}/${TRANSCRIPT}, but it looks like Whisper got stuck repeating ` +
          'itself rather than transcribing. That means it could not hear speech clearly; ' +
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
    } else if (err instanceof OutOfMemoryError && allowFallback && model === 'medium') {
      // Best is the override pick, and on a 32-bit wasm heap the medium
      // encoder can die mid-run even on a short talk; whether it fits is
      // down to allocation luck. The words matter more than the label, so
      // the same recording runs again on Balanced and the status line has
      // already said so. No second fallback: if Balanced dies too, that is
      // an error worth reading.
      say('Best ran out of memory on this machine. Transcribing on Balanced instead.');
      await transcribeInto(dir, name, 'small', false);
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
  ui.meeting.checked = savedSystemCapture();
  // Electron records the computer's own audio through a loopback device, and
  // it has one on Windows only. Everywhere else the checkbox could be ticked
  // and the recording would still be the microphone alone — which is a thing
  // to learn before a meeting rather than at the end of one. So it is turned
  // off and says why, in the tooltip and on the label.
  if (window.blab && !window.blab.device?.systemAudio) {
    ui.meeting.checked = false;
    ui.meeting.disabled = true;
    const label = ui.meeting.closest('label');
    if (label) {
      label.title = 'Recording the computer’s own audio needs a loopback device, which only Windows has.';
      label.classList.add('unavailable');
      label.append(' — Windows only');
    }
  }
  // First launch only: remember the machine's sensible default so the user
  // never has to pick. The picker still works afterwards.
  if (!localStorage.getItem('blab-model')) saveModel(suggestedModel());
  if (!('showDirectoryPicker' in window)) {
    ui.setup.classList.remove('hidden');
    ui.setupPick.disabled = true;
    say('Blab needs Chrome or Edge. Other browsers cannot write to a folder you pick.', true);
    return;
  }
  const saved = await recallRoot();
  if (saved) {
    const status = await connect(saved, false);
    if (status === 'ok') return;
    if (status === 'in-repo') {
      // Remembered from a version that allowed it. It will be refused every
      // time from here, so it is dropped rather than offered again; and the
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
