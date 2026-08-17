import { type ConvertHint, create } from '@mdgate/core';
import { fb2 } from './fb2.js';

const convert = create([fb2()]);

/**
 * Convert a single file's bytes to Markdown with the fb2 converter.
 * `hint.path` is only a sniff hint; it is never read from disk.
 */
export function toMarkdown(bytes: Uint8Array, hint?: ConvertHint): Promise<string> {
  return convert(bytes, hint);
}
