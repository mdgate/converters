/**
 * Type0 `/Encoding` CMaps: byte sequences → CID.
 *
 * Predefined tables are the official Adobe cmap-resources (GBK-EUC-H,
 * 90ms-RKSJ-H, ETen-B5-H, …). Uni* encodings store Unicode in the
 * content stream and are decoded as UTF-8/16/32 — no CID table needed.
 * Embedded CMap streams in the PDF are parsed with the same grammar.
 */

import { pdfMaps, type UniKind } from './maps.js';

export type { UniKind };

export interface EncodingCmap {
  name: string;
  decode(
    bytes: Uint8Array,
    offset: number,
  ): { code: number; cid: number; size: number } | undefined;
}

interface Resolved {
  space: number[];
  ranges: number[];
}

const resolvedCache = new Map<string, Resolved>();
const cmapCache = new Map<string, EncodingCmap>();

function overlayRanges(parent: number[], own: number[]): number[] {
  if (own.length === 0) return parent;
  if (parent.length === 0) return own;
  // Own ranges are appended; lookupCid scans from the end so they win.
  const out = parent.slice();
  for (let i = 0; i < own.length; i += 1) out.push(own[i]!);
  return out;
}

function resolvePacked(name: string, stack: string[] = []): Resolved {
  const hit = resolvedCache.get(name);
  if (hit) return hit;
  const packed = pdfMaps().enc[name];
  if (!packed || stack.includes(name)) return { space: [], ranges: [] };
  let space = packed.s ?? [];
  let ranges = packed.r ?? [];
  if (packed.b) {
    const parent = resolvePacked(packed.b, [...stack, name]);
    if (space.length === 0) space = parent.space;
    ranges = overlayRanges(parent.ranges, ranges);
  }
  const resolved = { space, ranges };
  resolvedCache.set(name, resolved);
  return resolved;
}

function lookupCid(ranges: number[], code: number): number {
  // Linear scan is fine for small overlay maps; large H maps are 4k ranges.
  // Binary search on start codes — ranges may overlap after overlay, so
  // walk from the end so later (own) ranges win.
  for (let i = ranges.length - 3; i >= 0; i -= 3) {
    const a = ranges[i]!;
    const b = ranges[i + 1]!;
    if (code >= a && code <= b) return ranges[i + 2]! + (code - a);
  }
  return 0;
}

function decodeWithResolved(
  resolved: Resolved,
  bytes: Uint8Array,
  offset: number,
): { code: number; cid: number; size: number } | undefined {
  const space = resolved.space;
  let best: { code: number; size: number } | undefined;
  for (let i = 0; i < space.length; i += 3) {
    const lo = space[i]!;
    const hi = space[i + 1]!;
    const n = space[i + 2]!;
    if (offset + n > bytes.length) continue;
    let code = 0;
    for (let k = 0; k < n; k += 1) code = ((code << 8) | bytes[offset + k]!) >>> 0;
    if (code < lo || code > hi) continue;
    if (!best || n > best.size) best = { code, size: n };
  }
  if (!best) return undefined;
  const cid = lookupCid(resolved.ranges, best.code);
  return { code: best.code, cid, size: best.size };
}

function makeCmap(name: string, resolved: Resolved): EncodingCmap {
  return {
    name,
    decode(bytes, offset) {
      return decodeWithResolved(resolved, bytes, offset);
    },
  };
}

export function encodingName(raw: string): string {
  return raw.startsWith('/') ? raw.slice(1) : raw;
}

export function uniKind(name: string): UniKind | undefined {
  return pdfMaps().uni[encodingName(name)];
}

export function encodingCmap(name: string): EncodingCmap | undefined {
  const key = encodingName(name);
  if (key === 'Identity-H' || key === 'Identity-V') return undefined;
  if (uniKind(key)) return undefined;
  const cached = cmapCache.get(key);
  if (cached) return cached;
  if (!pdfMaps().enc[key]) return undefined;
  const cmap = makeCmap(key, resolvePacked(key));
  cmapCache.set(key, cmap);
  return cmap;
}

/** Infer Adobe ROS ordering from a predefined Encoding name. */
export function inferAdobeOrdering(name: string): string | undefined {
  const key = encodingName(name);
  if (/^(GB|UniGB)/i.test(key)) return 'GB1';
  if (/^(B5|ETen|ETHK|CNS|HK|UniCNS)/i.test(key)) return 'CNS1';
  if (/^(KSC|UniKS)/i.test(key)) return 'Korea1';
  if (/^UniAKR/i.test(key)) return 'KR';
  if (
    /^(78|83pv|90|Add-|EUC-|Ext-|RKSJ|NWP|Hankaku|Hiragana|Katakana|Roman|WP-Symbol|UniJIS)/i.test(
      key,
    ) ||
    key === 'H' ||
    key === 'V'
  ) {
    return 'Japan1';
  }
  return undefined;
}

function hexToInt(h: string): number {
  const hx = h.replace(/[^0-9a-fA-F]/g, '');
  return hx.length === 0 ? 0 : Number.parseInt(hx, 16);
}

/** Parse an embedded Type0 Encoding CMap stream (cidrange / cidchar / usecmap). */
export function parseEmbeddedCmap(text: string): EncodingCmap | undefined {
  const use = text.match(/\/(\S+)\s+usecmap/);
  const parent = use ? encodingCmap(use[1]!) : undefined;
  let space: number[] = [];
  const cs = text.match(/begincodespacerange([\s\S]*?)endcodespacerange/);
  if (cs) {
    for (const m of cs[1]!.matchAll(/<([^>]*)>\s*<([^>]*)>/g)) {
      const a = m[1]!.replace(/[^0-9a-fA-F]/g, '');
      space.push(hexToInt(m[1]!), hexToInt(m[2]!), Math.max(1, Math.ceil(a.length / 2)));
    }
  }
  const ranges: number[] = [];
  let pos = 0;
  while (pos < text.length) {
    const start = text.indexOf('begincidrange', pos);
    if (start < 0) break;
    const end = text.indexOf('endcidrange', start);
    if (end < 0) break;
    const section = text.slice(start, end);
    for (const m of section.matchAll(/<([^>]*)>\s*<([^>]*)>\s*(-?\d+)/g)) {
      ranges.push(hexToInt(m[1]!), hexToInt(m[2]!), Number(m[3]));
    }
    pos = end + 11;
  }
  pos = 0;
  while (pos < text.length) {
    const start = text.indexOf('begincidchar', pos);
    if (start < 0) break;
    const end = text.indexOf('endcidchar', start);
    if (end < 0) break;
    const section = text.slice(start, end);
    for (const m of section.matchAll(/<([^>]*)>\s*(-?\d+)/g)) {
      const code = hexToInt(m[1]!);
      ranges.push(code, code, Number(m[2]));
    }
    pos = end + 10;
  }
  const parentRes = parent ? resolvePacked(parent.name) : { space: [], ranges: [] };
  if (space.length === 0) space = parentRes.space;
  const merged = overlayRanges(parentRes.ranges, ranges);
  if (space.length === 0 && merged.length === 0) return parent;
  const nameMatch = text.match(/\/CMapName\s*\/(\S+)\s+def/);
  return makeCmap(nameMatch?.[1] ?? 'Embedded', { space, ranges: merged });
}

export function decodeUni(
  kind: UniKind,
  bytes: Uint8Array,
  offset: number,
): { code: number; size: number } | undefined {
  if (kind === 'utf8') {
    if (offset >= bytes.length) return undefined;
    const b0 = bytes[offset]!;
    if (b0 < 0x80) return { code: b0, size: 1 };
    if ((b0 & 0xe0) === 0xc0 && offset + 1 < bytes.length) {
      return { code: ((b0 & 0x1f) << 6) | (bytes[offset + 1]! & 0x3f), size: 2 };
    }
    if ((b0 & 0xf0) === 0xe0 && offset + 2 < bytes.length) {
      return {
        code:
          ((b0 & 0x0f) << 12) | ((bytes[offset + 1]! & 0x3f) << 6) | (bytes[offset + 2]! & 0x3f),
        size: 3,
      };
    }
    if ((b0 & 0xf8) === 0xf0 && offset + 3 < bytes.length) {
      return {
        code:
          ((b0 & 0x07) << 18) |
          ((bytes[offset + 1]! & 0x3f) << 12) |
          ((bytes[offset + 2]! & 0x3f) << 6) |
          (bytes[offset + 3]! & 0x3f),
        size: 4,
      };
    }
    return { code: b0, size: 1 };
  }
  if (kind === 'utf32') {
    if (offset + 4 > bytes.length) return undefined;
    const code =
      ((bytes[offset]! << 24) |
        (bytes[offset + 1]! << 16) |
        (bytes[offset + 2]! << 8) |
        bytes[offset + 3]!) >>>
      0;
    return { code, size: 4 };
  }
  // utf16 / ucs2
  if (offset + 2 > bytes.length) return undefined;
  const w1 = ((bytes[offset]! << 8) | bytes[offset + 1]!) >>> 0;
  if (w1 >= 0xd800 && w1 <= 0xdbff && offset + 4 <= bytes.length) {
    const w2 = ((bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
    if (w2 >= 0xdc00 && w2 <= 0xdfff) {
      return { code: 0x10000 + ((w1 - 0xd800) << 10) + (w2 - 0xdc00), size: 4 };
    }
  }
  return { code: w1, size: 2 };
}
