/** Whisper wants mono PCM at 16 kHz. Anything else and it hears nonsense. */
export const SAMPLE_RATE = 16000;

/**
 * Decodes a recording into the samples Whisper expects. Lives on the main
 * thread because AudioContext is not available inside a worker; the resulting
 * buffer is handed to the worker and transcribed there.
 */
export async function decodeForWhisper(audio: Blob): Promise<Float32Array> {
  const bytes = await audio.arrayBuffer();
  // decodeAudioData resamples to the context's rate, which does the 16 kHz
  // conversion for us.
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const buffer = await ctx.decodeAudioData(bytes);

  // slice(), not the raw channel: getChannelData hands back a view into the
  // AudioBuffer's own memory, and the caller transfers what it gets from here.
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();

  // Fold every channel down to one, so a stereo mic does not halve the volume.
  const mono = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < mono.length; i++) mono[i] += channel[i];
  }
  for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels;
  return mono;
}
