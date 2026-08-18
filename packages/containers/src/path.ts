import { ConvertError } from '@mdgate/core';

export interface Target {
  /** Normalized archive path (no leading slash). */
  path: string;
  fragment: string | undefined;
}

/** Resolve a relative or package-absolute reference against the part it appears in. */
export function resolve(basePart: string, reference: string): Target {
  let fragment: string | undefined;
  const hash = reference.indexOf('#');
  if (hash >= 0) {
    fragment = decodeComponent(reference.slice(hash + 1));
    reference = reference.slice(0, hash);
  }
  const q = reference.indexOf('?');
  if (q >= 0) reference = reference.slice(0, q);
  if (reference.length === 0) {
    return { path: basePart, fragment };
  }

  const segments: string[] = [];
  if (!reference.startsWith('/')) {
    const slash = basePart.lastIndexOf('/');
    if (slash >= 0) {
      for (const s of basePart.slice(0, slash).split('/')) {
        if (s.length > 0) segments.push(s);
      }
    }
  }
  for (const raw of reference.split('/')) {
    if (raw.length === 0 || raw === '.') continue;
    if (raw === '..') {
      segments.pop();
      continue;
    }
    const decoded = decodeComponent(raw);
    if (decoded.includes('/') || decoded.includes('\\')) {
      throw ConvertError.malformed(
        `percent-encoded separator in package reference segment ${jsonDebug(raw)}`,
      );
    }
    if (decoded === '.' || decoded === '..') {
      throw ConvertError.malformed(
        `percent-encoded traversal in package reference segment ${jsonDebug(raw)}`,
      );
    }
    segments.push(decoded);
  }
  return { path: segments.join('/'), fragment };
}

export function decodeFragment(fragment: string): string {
  return decodeComponent(fragment);
}

const UTF8 = new TextEncoder();

/**
 * Percent-decode one URI component. A `%` not followed by two hex digits
 * passes through literally; non-UTF-8 decoded bytes degrade lossily.
 */
function decodeComponent(component: string): string {
  const bytes = UTF8.encode(component);
  const out: number[] = [];
  let i = 0;
  while (i < bytes.length) {
    if (bytes[i] === 0x25 && i + 2 < bytes.length) {
      const h1 = bytes[i + 1]!;
      const h2 = bytes[i + 2]!;
      if (isHexDigit(h1) && isHexDigit(h2)) {
        out.push((fromHex(h1) << 4) | fromHex(h2));
        i += 3;
        continue;
      }
    }
    out.push(bytes[i]!);
    i += 1;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Uint8Array.from(out));
}

function isHexDigit(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
}

function fromHex(c: number): number {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 65 && c <= 70) return c - 55;
  return c - 87;
}

/** JSON-quoted string. */
function jsonDebug(s: string): string {
  return JSON.stringify(s);
}
