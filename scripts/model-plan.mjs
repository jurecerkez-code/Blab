// What `npm run setup <argument>` should fetch, and what it should leave on
// disk afterwards.
//
// This is a separate file for one reason: the decision it makes is the one
// that broke the 0.7.x releases, and while it lived inside setup.mjs — a
// script that downloads a gigabyte the moment it is imported — nothing could
// test it. `all` asked the prune to keep an empty list, which is not "keep
// everything" but "keep nothing", so a build fetched every model and deleted
// every model, and the installer went out with no weights in it. Pure in, pure
// out, and tests/setup.spec.ts holds it to that.

/** The models the app can run, by the name the picker uses. */
export const MODELS = {
  base: 'Xenova/whisper-base',
  small: 'Xenova/whisper-small',
  medium: 'Xenova/whisper-medium',
};

/** The voice-activity detector. Not a Whisper model, and never the argument. */
export const VAD_REPO = 'onnx-community/silero-vad';

/** What a bare `npm run setup` fetches. */
export const DEFAULT_MODEL = 'base';

export const MODEL_NAMES = Object.keys(MODELS);

/**
 * Reads the command line and returns the plan.
 *
 * - `toFetch` — model names to download, in catalog order.
 * - `keep` — repository paths the prune may keep, or null to prune nothing.
 *
 * `keep` is null for a single named model because models accumulate on
 * purpose: which one the app loads is a runtime choice, so setup holds on to
 * everything it has ever fetched until something says otherwise.
 *
 * Throws on an argument that names no model, which is the one case where
 * guessing would be worse than stopping.
 */
export function plan(argv = []) {
  const want = argv.join(' ').toLowerCase().trim();

  // Everything: fetch the catalog, and keep exactly the catalog. Anything else
  // under public/models is a model from an older version of this file, which
  // is what the prune is for — electron-builder copies that folder wholesale,
  // so a forgotten model is pure installer weight.
  if (want === 'all') {
    return { toFetch: [...MODEL_NAMES], keep: [...MODEL_NAMES.map((n) => MODELS[n]), VAD_REPO] };
  }

  // Back to the default model alone. Fetches nothing: whatever is being kept
  // is already there, and whatever is not is not wanted.
  if (want === 'clean') {
    return { toFetch: [], keep: [MODELS[DEFAULT_MODEL], VAD_REPO] };
  }

  // No argument is the documented default. It has to be tested before the
  // search below, because ''.includes('base') is false and an empty argv used
  // to fall past every branch into the throw — which is what killed every
  // release build from 0.7.0 on, the workflow running a bare `npm run setup`.
  if (!want) return { toFetch: [DEFAULT_MODEL], keep: null };

  const pick = MODEL_NAMES.find((n) => want.includes(n));
  if (!pick) {
    throw new Error(`Unknown model "${argv.join(' ')}". Use: ${MODEL_NAMES.join(', ')}, all or clean.`);
  }
  return { toFetch: [pick], keep: null };
}
