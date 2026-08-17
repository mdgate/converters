import { type ConvertHint, create } from '@mdgate/core';
import { wps } from './wps.js';

const convert = create([wps()]);

/**
 * Convert a single file's bytes to Markdown with the wps converter.
 * `hint.path` is only a sniff hint; it is never read from disk.
 */
export function toMarkdown(bytes: Uint8Array, hint?: ConvertHint): Promise<string> {
  return convert(bytes, hint);
}
