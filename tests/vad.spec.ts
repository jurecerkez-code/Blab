// How Blab reads a silero model's tensor names.
//
// This is the bug that cost the app its silence detection for six releases,
// and it is one function call wide. The old code looked for inputs literally
// named h and c; the model that actually ships names them input/state/sr and
// returns output/stateN, so detection threw before a frame ever ran — and the
// worker swallowed it. Names in, plan out, no model required.
import { expect, test } from '@playwright/test';
import { assembleSpeech, sileroPlan, windowsFromProbs } from '../src/vad';

// Exactly what onnx reports for the model in public/models, read off the
// installed file rather than assumed.
const V5_IN = ['input', 'state', 'sr'];
const V5_OUT = ['output', 'stateN'];
// The older export, still worth handling: two state tensors, half as wide.
const V4_IN = ['input', 'sr', 'h', 'c'];
const V4_OUT = ['output', 'hn', 'cn'];

test.describe('reading a silero model', () => {
  test('the shipped v5 export is understood', () => {
    const plan = sileroPlan(V5_IN, V5_OUT);
    expect(plan.audioName).toBe('input');
    expect(plan.srName).toBe('sr');
    expect(plan.stateIns).toEqual(['state']);
    // stateN, not state. The output map is never keyed by the input names.
    expect(plan.stateOuts).toEqual(['stateN']);
    expect(plan.hidden).toBe(128);
  });

  test('the older v4 export is understood too', () => {
    const plan = sileroPlan(V4_IN, V4_OUT);
    expect(plan.audioName).toBe('input');
    expect(plan.srName).toBe('sr');
    expect(plan.stateIns).toEqual(['h', 'c']);
    expect(plan.stateOuts).toEqual(['hn', 'cn']);
    // Two tensors means the narrow pair.
    expect(plan.hidden).toBe(64);
  });

  test('the state is never read back under the name it was fed', () => {
    for (const [ins, outs] of [
      [V5_IN, V5_OUT],
      [V4_IN, V4_OUT],
    ] as const) {
      const { stateIns, stateOuts } = sileroPlan(ins, outs);
      for (const name of stateOuts) expect(stateIns).not.toContain(name);
      expect(stateOuts).toHaveLength(stateIns.length);
    }
  });

  test('the sample-rate input is never mistaken for the audio', () => {
    // 'sr' is short and sits among longer names; picking it as the audio input
    // would feed 512 samples into a scalar.
    expect(sileroPlan(['sr', 'input', 'state'], V5_OUT).audioName).toBe('input');
    expect(sileroPlan(['sr', 'input', 'state'], V5_OUT).srName).toBe('sr');
  });

  test('a model with no sample-rate input still works', () => {
    const plan = sileroPlan(['input', 'state'], V5_OUT);
    expect(plan.srName).toBeUndefined();
    expect(plan.stateIns).toEqual(['state']);
  });

  test('a shape it cannot pair names itself instead of failing quietly', () => {
    // The whole point: when this cannot work it says what it was given, so the
    // next person does not have to guess. Silence is what made it last.
    expect(() => sileroPlan(['input', 'sr'], ['output'])).toThrow(/Unexpected silero ONNX/);
    expect(() => sileroPlan(['input', 'state', 'sr'], ['output'])).toThrow(/input, state, sr/);
    expect(() => sileroPlan(['input', 'state', 'sr'], ['output'])).toThrow(/outputs output/);
  });
});
