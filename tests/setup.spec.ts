// features/installer-contents.feature, executed.
//
// These run in Node rather than the browser — a Playwright spec body always
// does — so the plan is imported straight from scripts/. It is a pure function
// on purpose: the rules below are the ones that shipped broken twice, and they
// could not be tested while they lived inside a script that downloads a
// gigabyte on import.
import { expect, test } from '@playwright/test';
import { MODELS, MODEL_NAMES, VAD_REPO, plan } from '../scripts/model-plan.mjs';

/** What survives a prune of `onDisk`, given the plan's keep-list. */
function afterPrune(onDisk: string[], keep: string[] | null): string[] {
  if (!keep) return [...onDisk];
  return onDisk.filter((repo) => keep.includes(repo));
}

const EVERY_MODEL = MODEL_NAMES.map((n) => MODELS[n]);

test.describe('what setup fetches', () => {
  test('no argument fetches the model the header promises', () => {
    const { toFetch, keep } = plan([]);
    expect(toFetch).toEqual(['base']);
    // Nothing was asked about, so nothing is pruned.
    expect(keep).toBeNull();
  });

  test('naming a model fetches that one and no other', () => {
    expect(plan(['small']).toFetch).toEqual(['small']);
    expect(plan(['medium']).toFetch).toEqual(['medium']);
    expect(plan(['base']).toFetch).toEqual(['base']);
  });

  test('asking for everything fetches the whole catalog', () => {
    expect(plan(['all']).toFetch).toEqual(MODEL_NAMES);
    expect(plan(['all']).toFetch).toHaveLength(3);
  });

  test('cleaning fetches nothing', () => {
    expect(plan(['clean']).toFetch).toEqual([]);
  });

  test('a word that names no model stops rather than guesses', () => {
    expect(() => plan(['banana'])).toThrow(/Unknown model "banana"/);
    // And says what it would have taken, so the message is worth reading.
    expect(() => plan(['banana'])).toThrow(/base, small, medium, all or clean/);
  });
});

test.describe('what setup keeps', () => {
  test('everything fetched is everything kept', () => {
    const { toFetch, keep } = plan(['all']);
    const survivors = afterPrune(EVERY_MODEL, keep);
    // The regression: keep was [], the prune read that as "keep nothing", and
    // a build fetched 1,059 MB then deleted all of it. An empty survivor list
    // here is an installer with no speech model in it.
    expect(survivors).toEqual(EVERY_MODEL);
    expect(survivors).toHaveLength(toFetch.length);
  });

  test('the prune still removes a model that left the catalog', () => {
    const { keep } = plan(['all']);
    const stale = 'Xenova/whisper-tiny';
    const survivors = afterPrune([...EVERY_MODEL, stale], keep);
    expect(survivors).not.toContain(stale);
    for (const repo of EVERY_MODEL) expect(survivors).toContain(repo);
  });

  test('cleaning goes back to the fast model alone', () => {
    const { keep } = plan(['clean']);
    const survivors = afterPrune(EVERY_MODEL, keep);
    expect(survivors).toEqual([MODELS.base]);
  });

  test('the detector is never collateral', () => {
    // Not a Whisper model, never what the argument is about, and both prunes
    // used to take it — silence detection went with it.
    for (const argv of [['all'], ['clean']]) {
      const { keep } = plan(argv);
      expect(afterPrune([...EVERY_MODEL, VAD_REPO], keep)).toContain(VAD_REPO);
    }
  });

  test('models accumulate when no one asked otherwise', () => {
    // Which model the app loads is a runtime choice, so a named fetch keeps
    // whatever was already there.
    const { keep } = plan(['medium']);
    expect(afterPrune([MODELS.small, MODELS.medium], keep)).toEqual([
      MODELS.small,
      MODELS.medium,
    ]);
  });
});
