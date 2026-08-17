/** Hangul HWP (OLE / classic signature) and HWPX (ZIP + OWPML). */

import { hasOleMagic } from '@mdgate/containers';
import { ConvertError } from '@mdgate/core';
import type { Document } from '@mdgate/document';
import { hasHwpSignature, parseHwp } from './hwp.js';
import { parseHwpx } from './hwpx.js';

export { hasHwpSignature } from './hwp.js';

export function parse(bytes: Uint8Array): Document {
  if (isZip(bytes)) return parseHwpx(bytes);
  if (hasOleMagic(bytes) || hasHwpSignature(bytes)) return parseHwp(bytes);
  throw ConvertError.malformed('not an HWP document');
}

function isZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}
