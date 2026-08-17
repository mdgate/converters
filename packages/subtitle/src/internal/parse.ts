import { type Document, emptyDocument, type Inline, PLAIN, type Style } from '@mdgate/document';
import { cleanText, collapseWs, decode, lines, trim } from '@mdgate/utils';

const ITALIC: Style = { bold: false, italic: true, strike: false, code: false };

const TIMING =
  /^\s*(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\s*-->\s*(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})\b/;

const ASS_TAG = /\{[^}]*\}/g;
const AN_TAG = /\\an\d+/gi;
const MARKUP_TAG = /<[^>]*>/g;
const ENTITY = /&(?:amp|lt|gt|quot|apos|nbsp|lrm|rlm|#\d+|#x[\da-f]+);/gi;

export function parse(bytes: Uint8Array): Document {
  const text = stripBom(decodeText(bytes)).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = lines(text);
  const doc = emptyDocument();
  let i = 0;

  if (isWebvttHeader(rows[0])) {
    i = 1;
    while (i < rows.length && trim(rows[i]!).length > 0) {
      if (parseStart(rows[i]!) !== undefined) break;
      if (i + 1 < rows.length && parseStart(rows[i + 1]!) !== undefined) break;
      i += 1;
    }
  }

  while (i < rows.length) {
    const line = rows[i]!;
    if (trim(line).length === 0) {
      i += 1;
      continue;
    }
    if (isSkippableBlock(line)) {
      i += 1;
      while (i < rows.length && trim(rows[i]!).length > 0) i += 1;
      continue;
    }

    let start = parseStart(line);
    if (start === undefined && i + 1 < rows.length) {
      start = parseStart(rows[i + 1]!);
      if (start !== undefined) i += 1;
    }
    if (start === undefined) {
      i += 1;
      while (i < rows.length && trim(rows[i]!).length > 0) i += 1;
      continue;
    }

    i += 1;
    const payload: string[] = [];
    while (i < rows.length && trim(rows[i]!).length > 0) {
      if (parseStart(rows[i]!) !== undefined) break;
      if (i + 1 < rows.length && parseStart(rows[i + 1]!) !== undefined) break;
      payload.push(rows[i]!);
      i += 1;
    }
    const cue = cleanCueText(payload.join(' '));
    if (cue.length === 0) continue;
    doc.blocks.push({ type: 'paragraph', inlines: cueInlines(start, cue) });
  }

  return doc;
}

function cueInlines(start: string, text: string): Inline[] {
  return [
    { type: 'text', text: `[${start}]`, style: ITALIC },
    { type: 'text', text: ` ${text}`, style: PLAIN },
  ];
}

function parseStart(line: string): string | undefined {
  const m = TIMING.exec(line);
  if (m === null) return undefined;
  const hours = m[1] !== undefined ? Number(m[1]) : 0;
  const minutes = Number(m[2]);
  const seconds = Number(m[3]);
  const ms = Number(m[4]);
  if (!Number.isFinite(hours + minutes + seconds + ms)) return undefined;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(ms, 3)}`;
}

function isWebvttHeader(line: string | undefined): boolean {
  if (line === undefined) return false;
  return /^WEBVTT(?:$|[\s\uFEFF])/.test(line);
}

function isSkippableBlock(line: string): boolean {
  const t = trim(line);
  return startsWord(t, 'NOTE') || startsWord(t, 'STYLE') || startsWord(t, 'REGION');
}

function startsWord(line: string, word: string): boolean {
  if (line.length < word.length) return false;
  if (line.slice(0, word.length).toUpperCase() !== word) return false;
  return line.length === word.length || isXmlSpace(line.charCodeAt(word.length));
}

function isXmlSpace(c: number): boolean {
  return c === 0x09 || c === 0x0a || c === 0x0d || c === 0x20;
}

function cleanCueText(raw: string): string {
  const stripped = raw.replace(ASS_TAG, '').replace(AN_TAG, '').replace(MARKUP_TAG, '');
  return trim(collapseWs(cleanText(decodeEntities(stripped))));
}

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (entity) => {
    const lower = entity.toLowerCase();
    switch (lower) {
      case '&amp;':
        return '&';
      case '&lt;':
        return '<';
      case '&gt;':
        return '>';
      case '&quot;':
        return '"';
      case '&apos;':
        return "'";
      case '&nbsp;':
        return ' ';
      case '&lrm;':
      case '&rlm;':
        return '';
      default:
        break;
    }
    if (lower.startsWith('&#x')) {
      const n = Number.parseInt(lower.slice(3, -1), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : '';
    }
    if (lower.startsWith('&#')) {
      const n = Number.parseInt(lower.slice(2, -1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : '';
    }
    return '';
  });
}

function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return decode(bytes, 'utf-16le');
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return decode(bytes, 'utf-16be');
  }
  const rest =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? bytes.subarray(3)
      : bytes;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(rest);
  } catch {
    return decode(rest, 'windows-1252');
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, '0');
}
