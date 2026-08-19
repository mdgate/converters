import { hasOleMagic } from '@mdgate/containers';
import type { Converter, ConvertHint, ConvertOptions, ConvertResult } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';
import { fileExtension } from '@mdgate/utils';
import { parse } from './internal/index.js';
import { hasMsgStreams } from './internal/msg.js';

const EXTS = new Set(['eml', 'msg', 'mbox', 'emlx']);

export function email(): Converter {
  return {
    id: 'email',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (hasOleMagic(bytes)) {
        if (hasMsgStreams(bytes)) return 2;
        if (hint?.path !== undefined && fileExtension(hint.path) === 'msg') return 1;
        return 0;
      }
      if (looksLikeRfc822(bytes)) return 3;
      if (hint?.path !== undefined && EXTS.has(fileExtension(hint.path) ?? '')) return 1;
      return 0;
    },
    convert(bytes: Uint8Array, options?: ConvertOptions): ConvertResult {
      refuseForeign(bytes);
      return { markdown: documentToMarkdown(parse(bytes, options?.path)) };
    },
  };
}

function refuseForeign(bytes: Uint8Array): void {
  if (isPdf(bytes)) throw ConvertError.unsupported('pdf');
  if (isZip(bytes)) throw ConvertError.unsupported('zip');
  if (hasOleMagic(bytes) && !hasMsgStreams(bytes)) {
    throw ConvertError.unsupported('ole');
  }
}

function looksLikeRfc822(bytes: Uint8Array): boolean {
  let i = skipBomAndWs(bytes);
  if (isYamlDocStart(bytes, i)) return false;
  i = skipEmlxLengthLine(bytes, i);
  if (isFromSpace(bytes, i)) i = nextLine(bytes, i);
  const limit = Math.min(bytes.length, i + 4096);
  while (i < limit) {
    const end = lineEnd(bytes, i, limit);
    if (end.line === i) break;
    if (bytes[i] === 0x20 || bytes[i] === 0x09) {
      i = end.next;
      continue;
    }
    const name = headerName(bytes, i, end.line);
    if (name === 'from' || name === 'mime-version') return true;
    i = end.next;
  }
  return false;
}

function isYamlDocStart(bytes: Uint8Array, i: number): boolean {
  if (!startsWithAscii(bytes, '---', i)) return false;
  const next = bytes[i + 3];
  return next === undefined || next === 0x0a || next === 0x0d || next === 0x20 || next === 0x09;
}

function skipEmlxLengthLine(bytes: Uint8Array, start: number): number {
  let i = start;
  while (i < bytes.length && bytes[i]! >= 0x30 && bytes[i]! <= 0x39) i += 1;
  if (i === start) return start;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09)) i += 1;
  if (bytes[i] === 0x0d) i += 1;
  if (bytes[i] === 0x0a) i += 1;
  else return start;
  return i;
}

function isFromSpace(bytes: Uint8Array, i: number): boolean {
  return (
    i + 5 <= bytes.length &&
    bytes[i] === 0x46 &&
    bytes[i + 1] === 0x72 &&
    bytes[i + 2] === 0x6f &&
    bytes[i + 3] === 0x6d &&
    bytes[i + 4] === 0x20
  );
}

function headerName(bytes: Uint8Array, start: number, end: number): string | undefined {
  let colon = -1;
  for (let i = start; i < end; i += 1) {
    if (bytes[i] === 0x3a) {
      colon = i;
      break;
    }
  }
  if (colon <= start) return undefined;
  let a = start;
  let b = colon;
  while (a < b && (bytes[a] === 0x20 || bytes[a] === 0x09)) a += 1;
  while (b > a && (bytes[b - 1] === 0x20 || bytes[b - 1] === 0x09)) b -= 1;
  if (b <= a) return undefined;
  let name = '';
  for (let i = a; i < b; i += 1) {
    const c = bytes[i]!;
    const ok =
      (c >= 0x41 && c <= 0x5a) ||
      (c >= 0x61 && c <= 0x7a) ||
      (c >= 0x30 && c <= 0x39) ||
      c === 0x2d;
    if (!ok) return undefined;
    name += String.fromCharCode(c >= 0x41 && c <= 0x5a ? c + 32 : c);
  }
  return name;
}

function lineEnd(bytes: Uint8Array, i: number, limit: number): { line: number; next: number } {
  let j = i;
  while (j < limit && bytes[j] !== 0x0a && bytes[j] !== 0x0d) j += 1;
  let next = j;
  if (bytes[next] === 0x0d) next += 1;
  if (bytes[next] === 0x0a) next += 1;
  return { line: j, next };
}

function nextLine(bytes: Uint8Array, i: number): number {
  return lineEnd(bytes, i, bytes.length).next;
}

function skipBomAndWs(bytes: Uint8Array): number {
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x20) break;
    i += 1;
  }
  return i;
}

function isPdf(bytes: Uint8Array): boolean {
  return startsWithAscii(bytes, '%PDF-', skipBomAndWs(bytes));
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

function startsWithAscii(bytes: Uint8Array, prefix: string, offset: number): boolean {
  if (offset + prefix.length > bytes.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[offset + i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
}
