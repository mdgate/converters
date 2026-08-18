/** Adobe CID → Unicode from the official pdf2unicode CMaps. */

import { inflateZlib } from '@mdgate/utils';
import { ADOBE_CID } from './generated/adobe-cid-data.js';

const cache = new Map<string, Map<number, string>>();

function decodeBase64(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  const buf = Buffer.from(b64, 'base64');
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function loadCollection(ordering: string): Map<number, string> | undefined {
  const blob = ADOBE_CID[ordering];
  if (!blob) return undefined;
  const hit = cache.get(ordering);
  if (hit) return hit;
  const raw = inflateZlib(decodeBase64(blob.bmp), 1 << 20);
  const map = new Map<number, string>();
  for (let cid = 0; cid * 2 + 1 < raw.length; cid += 1) {
    const cp = raw[cid * 2]! | (raw[cid * 2 + 1]! << 8);
    if (cp !== 0) map.set(cid, String.fromCodePoint(cp));
  }
  const extra = blob.extra;
  for (let i = 0; i + 1 < extra.length; i += 2) {
    const cid = extra[i]!;
    const cp = extra[i + 1]!;
    if (cp > 0) map.set(cid, String.fromCodePoint(cp));
  }
  cache.set(ordering, map);
  return map;
}

/** `Adobe-GB1` / `GB1` / `Adobe-Japan1` → collection key. */
export function adobeOrderingKey(registry: string, ordering: string): string | undefined {
  if (registry.toLowerCase() !== 'adobe') return undefined;
  const key = ordering.replace(/^Adobe-/i, '');
  if (key in ADOBE_CID) return key;
  return undefined;
}

export function adobeCidToUnicode(orderingKey: string, cid: number): string | undefined {
  return loadCollection(orderingKey)?.get(cid);
}

export function fillAdobeCidMap(orderingKey: string, cmap: Map<number, string>): void {
  const table = loadCollection(orderingKey);
  if (!table) return;
  for (const [cid, ch] of table) {
    if (!cmap.has(cid)) cmap.set(cid, ch);
  }
}
