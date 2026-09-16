/**
 * Whisper marks timestamps as plain tokens, so skip_special_tokens leaves
 * them in and they clog partial text. The bundled tokenizer numbers them
 * 50364..51864 (<|0.00|> is 50364); anything below is text or a special the
 * streamer already skips, so a range test is enough and never decodes.
 *
 * Every chunk starts with an all-timestamp run, so the filtered stream can
 * come out empty, and the streamer's decoder throws on an empty array
 * ("token_ids must be a non-empty array of integers"). The end token is a
 * real special, so it decodes to nothing. Fixing that condition must stay:
 * 0.7.4 transcribes zero words otherwise, crash on chunk one.
 */
export function filterTimestampTokens(tokens: bigint[]): bigint[] {
  const keep = tokens.filter((token) => Number(token) < 50364);
  return keep.length ? keep : [50257n];
}
