import { type Document, emptyDocument, plain } from '@mdgate/document';
import { trim } from '@mdgate/utils';

/** encoding_rs / WHATWG windows-1252 for bytes 0x80–0x9F. */
const WIN1252_80_9F =
  '\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178';

/** Decode BOM UTF-8 / UTF-16 like @mdgate/csv, then UTF-8, then Windows-1252. */
export function decodeText(bytes: Uint8Array): string {
  return stripUtf8Bom(decode(bytes));
}

export function toParagraphs(text: string): Document {
  const doc = emptyDocument();
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (const chunk of normalized.split(/\n(?:[ \t]*\n)+/)) {
    const para = trim(chunk);
    if (para.length === 0) continue;
    doc.blocks.push({ type: 'paragraph', inlines: [plain(para)] });
  }
  return doc;
}

export function toSourceDoc(text: string, lang: string): Document {
  const doc = emptyDocument();
  doc.blocks.push({ type: 'codeBlock', lang, text });
  return doc;
}

function decode(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes);
  }
  const rest =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? bytes.subarray(3)
      : bytes;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(rest);
  } catch {
    return decodeWindows1252(rest);
  }
}

function decodeWindows1252(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i]!;
    if (b < 0x80 || b >= 0xa0) out += String.fromCharCode(b);
    else out += WIN1252_80_9F[b - 0x80]!;
  }
  return out;
}

function stripUtf8Bom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
