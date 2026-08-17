import {
  type MimePart,
  mimeAttachments,
  mimeHeader,
  mimeTextHtml,
  mimeTextPlain,
  parseMime,
} from '@mdgate/containers';
import { type Document, emptyDocument } from '@mdgate/document';
import { fileExtension, trim } from '@mdgate/utils';
import {
  attachmentBlocks,
  decodePart,
  headerBlocks,
  htmlToBlocks,
  plainParagraphs,
} from './body.js';

export function parseMimeMessage(bytes: Uint8Array, path?: string): Document {
  const root = parseMime(unwrapEmlx(bytes, path));
  if (root.contentType === 'application/mbox') {
    const doc = emptyDocument();
    for (let i = 0; i < root.parts.length; i += 1) {
      if (i > 0) doc.blocks.push({ type: 'rule' });
      const part = messageFromPart(root.parts[i]!);
      doc.blocks.push(...part.blocks);
    }
    return doc;
  }
  return messageFromPart(root);
}

function messageFromPart(part: MimePart): Document {
  const doc = emptyDocument();
  doc.blocks.push(
    ...headerBlocks({
      subject: mimeHeader(part, 'subject'),
      from: mimeHeader(part, 'from'),
      to: mimeHeader(part, 'to'),
      cc: mimeHeader(part, 'cc'),
      date: mimeHeader(part, 'date'),
    }),
  );
  const html = mimeTextHtml(part);
  const plain = mimeTextPlain(part);
  if (html !== undefined) {
    const blocks = htmlToBlocks(decodePart(html));
    if (blocks.length > 0) doc.blocks.push(...blocks);
    else if (plain !== undefined) doc.blocks.push(...plainParagraphs(decodePart(plain)));
  } else if (plain !== undefined) {
    doc.blocks.push(...plainParagraphs(decodePart(plain)));
  } else if (part.parts.length === 0 && part.bytes.length > 0) {
    doc.blocks.push(...plainParagraphs(decodePart(part)));
  }
  const names = mimeAttachments(part).map((att) => att.filename ?? att.contentType ?? 'attachment');
  doc.blocks.push(...attachmentBlocks(names));
  return doc;
}

function unwrapEmlx(bytes: Uint8Array, path?: string): Uint8Array {
  const ext = path !== undefined ? fileExtension(path) : undefined;
  if (ext !== 'emlx' && !looksLikeEmlx(bytes)) return bytes;
  return stripEmlx(bytes);
}

function looksLikeEmlx(bytes: Uint8Array): boolean {
  const first = firstLine(bytes);
  if (!/^\d+$/.test(trim(first.text))) return false;
  const rest = bytes.subarray(first.next);
  let i = 0;
  while (i < rest.length && (rest[i] === 0x20 || rest[i] === 0x09)) i += 1;
  return headerish(rest, i);
}

function stripEmlx(bytes: Uint8Array): Uint8Array {
  const first = firstLine(bytes);
  const n = Number(trim(first.text));
  if (!Number.isSafeInteger(n) || n < 0) return bytes;
  const start = first.next;
  const end = Math.min(bytes.length, start + n);
  return bytes.subarray(start, end);
}

function firstLine(bytes: Uint8Array): { text: string; next: number } {
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  const start = i;
  while (i < bytes.length && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i += 1;
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(start, i));
  if (bytes[i] === 0x0d) i += 1;
  if (bytes[i] === 0x0a) i += 1;
  return { text, next: i };
}

function headerish(bytes: Uint8Array, start: number): boolean {
  let i = start;
  while (i < bytes.length && bytes[i] !== 0x0a && bytes[i] !== 0x0d && bytes[i] !== 0x3a) i += 1;
  if (i >= bytes.length || bytes[i] !== 0x3a || i === start) return false;
  for (let j = start; j < i; j += 1) {
    const c = bytes[j]!;
    const ok =
      (c >= 0x41 && c <= 0x5a) ||
      (c >= 0x61 && c <= 0x7a) ||
      (c >= 0x30 && c <= 0x39) ||
      c === 0x2d;
    if (!ok) return false;
  }
  return true;
}
