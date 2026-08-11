// Remembers when each part of your notes was written.
//
// Blab's one real difference from a transcription service is that you are
// typing while it listens. That means the notes already say which parts
// mattered — nobody has to guess it back out afterwards. Keeping the moment
// each thought was written is what turns them from a separate document into an
// index into the talk.
//
// The unit is a burst of typing, not a line. Lines were the obvious choice and
// the wrong one: a textarea wraps, so someone writing a paragraph without ever
// pressing Enter is writing one line, and the whole paragraph came back
// stamped with the second its first word was typed. What people actually do is
// write a bit, listen, write a bit more. Each time they come back after a
// pause, that is a new thing they heard, and that is where a new time belongs.
import { stamp } from './timeline';

/** Long enough to mean "listened, then wrote again" rather than "thought mid-word". */
const PAUSE_MS = 4000;

/** A moment in the recording, and where in the text it starts. */
type Mark = { offset: number; at: number };

export class NoteClock {
  private marks: Mark[] = [];
  private length = 0;
  /** Recorded time of the last keystroke, to spot the gap before the next one. */
  private last = -Infinity;

  /**
   * Called when a new recording starts; the old times mean nothing now.
   *
   * `existing` is whatever is already in the box at that moment. Without it the
   * first keystroke looks like the entire contents arriving at once, and
   * everything written before Record was pressed gets stamped as if it had been
   * said in the talk.
   */
  reset(existing = ''): void {
    this.marks = [];
    this.length = existing.length;
    this.last = -Infinity;
  }

  /**
   * Call on every input event while recording, with the textarea's value and
   * caret *after* the edit, and the recorded time right now.
   *
   * A new mark is laid down when typing resumes after a pause, and whenever a
   * line break is typed — someone who does press Enter has told us where one
   * thought ends, and that is worth taking at face value.
   */
  mark(value: string, caret: number, at: number): void {
    const grew = value.length - this.length;
    // Where this edit happened. For ordinary typing and pasting the caret sits
    // just past what was inserted; for a deletion it sits where the text was.
    const edited = Math.max(0, caret - Math.max(0, grew));

    // Text inserted or removed before an existing mark moves it along with the
    // words it points at. Marks inside a stretch that was deleted collapse onto
    // the edit and are dropped as duplicates below.
    for (const m of this.marks) {
      if (m.offset > edited) m.offset = Math.max(edited, m.offset + grew);
    }

    // A new thought is added at the end. Going back into what is already there
    // is fixing a typo, and however long afterwards that happens, it does not
    // mean the sentence was heard twice.
    const appending = edited >= this.length;
    const broke = grew > 0 && value.slice(edited, caret).includes('\n');
    const rested = at - this.last > PAUSE_MS;
    if (grew > 0 && (broke || (appending && (rested || !this.marks.length)))) {
      // A break belongs to the text after it, not to the newline itself.
      const start = broke ? caret : edited;
      this.marks.push({ offset: start, at });
    }

    this.length = value.length;
    this.last = at;
    this.tidy();
  }

  /** Keeps marks in order and never two at the same place — the later one wins. */
  private tidy(): void {
    this.marks.sort((a, b) => a.offset - b.offset || a.at - b.at);
    this.marks = this.marks.filter((m, i) => this.marks[i + 1]?.offset !== m.offset);
  }

  /**
   * The notes as they go to disk: each burst on its own line behind the time it
   * was written at.
   *
   * Text written before Record was pressed has no time to give and keeps none,
   * so notes taken without a recording look exactly as they always did.
   */
  render(value: string): string {
    if (!this.marks.length) return value;

    const out: string[] = [];
    const first = this.marks[0].offset;
    // Anything typed before the recording started stays where it was, untimed.
    if (first > 0) out.push(value.slice(0, first).replace(/\n+$/, ''));

    this.marks.forEach((m, i) => {
      const end = this.marks[i + 1]?.offset ?? value.length;
      // A burst can hold line breaks if it was typed fast enough. They stay in
      // the text; only the first line takes the time.
      const body = value.slice(m.offset, end).trim();
      if (body) out.push(stamp(m.at) + body);
    });

    return out.join('\n');
  }
}
