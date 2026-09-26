/**
 * The engine's failures reach this code as text, or as almost nothing: a wasm
 * memory abort throws a bare number (seen: 1283623640, the medium encoder's
 * weights as one float array). Either way the person reading the red line
 * needs words and a next step, not a pointer.
 */
export function engineOutOfMemory(raw: string): boolean {
  return (
    /^\d+$/.test(raw) ||
    /failed to allocate|out of memory|cannot enlarge memory|abort\(oom/i.test(raw)
  );
}

export function engineWords(raw: string): string {
  if (engineOutOfMemory(raw)) {
    return (
      'Whisper ran out of memory on this machine with this model. ' +
      'Switch the model to Balanced and transcribe again. Balanced holds the same words, faster.'
    );
  }
  return raw;
}