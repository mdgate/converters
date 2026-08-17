import { hasOleMagic } from '@mdgate/containers';
import { ConvertError } from '@mdgate/core';
import type { Document } from '@mdgate/document';
import { parseVsd } from './vsd.js';
import { parseVsdx } from './vsdx.js';

export function parse(bytes: Uint8Array): Document {
  if (hasOleMagic(bytes)) return parseVsd(bytes);
  if (isZip(bytes)) return parseVsdx(bytes);
  throw ConvertError.unsupported('visio');
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
