import { hasOleMagic } from '@mdgate/containers';
import type { Document } from '@mdgate/document';
import { parseMimeMessage } from './mime.js';
import { parseMsg } from './msg.js';

export function parse(bytes: Uint8Array, path?: string): Document {
  if (hasOleMagic(bytes)) return parseMsg(bytes);
  return parseMimeMessage(bytes, path);
}
