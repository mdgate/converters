import { type ConvertHint, create } from '@mdgate/core';
import { text } from './text.js';

const convert = create([text()]);

/**
 * Convert a single file's bytes to Markdown with the text converter.
 * `hint.path` is only a sniff hint; it is never read from disk.
 */
export function toMarkdown(bytes: Uint8Array, hint?: ConvertHint): Promise<string> {
  return convert(bytes, hint);
}
