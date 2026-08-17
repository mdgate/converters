import { CompoundFile, hasOleMagic, mimeHeader, parseMime } from '@mdgate/containers';
import { ConvertError } from '@mdgate/core';
import { type Document, emptyDocument } from '@mdgate/document';
import { trim } from '@mdgate/utils';
import {
  attachmentBlocks,
  decodeBytes,
  headerBlocks,
  htmlToBlocks,
  plainParagraphs,
} from './body.js';

const PR_SUBJECT = 0x0037;
const PR_CLIENT_SUBMIT_TIME = 0x0039;
const PR_SENT_REPRESENTING_NAME = 0x0042;
const PR_SENT_REPRESENTING_EMAIL = 0x0065;
const PR_TRANSPORT_HEADERS = 0x007d;
const PR_SENDER_NAME = 0x0c1a;
const PR_SENDER_EMAIL = 0x0c1f;
const PR_DISPLAY_CC = 0x0e03;
const PR_DISPLAY_TO = 0x0e04;
const PR_MESSAGE_DELIVERY_TIME = 0x0e06;
const PR_BODY = 0x1000;
const PR_HTML = 0x1013;
const PR_DISPLAY_NAME = 0x3001;
const PR_ATTACH_FILENAME = 0x3704;
const PR_ATTACH_LONG_FILENAME = 0x3707;

const FILETIME_EPOCH_MS = 11_644_473_600_000;

export function hasMsgStreams(bytes: Uint8Array): boolean {
  if (!hasOleMagic(bytes)) return false;
  try {
    const ole = CompoundFile.open(bytes);
    for (const entry of ole.readRootStorage()) {
      if (isMsgName(entry.name)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function parseMsg(bytes: Uint8Array): Document {
  let ole: CompoundFile;
  try {
    ole = CompoundFile.open(bytes);
  } catch (e) {
    if (e instanceof ConvertError) throw e;
    throw ConvertError.malformed('not an Outlook message');
  }
  if (!hasMsgEntries(ole)) {
    throw ConvertError.unsupported('ole');
  }

  const transport = parseTransport(ole);
  const from =
    formatAddress(readString(ole, PR_SENDER_NAME), readString(ole, PR_SENDER_EMAIL)) ??
    formatAddress(
      readString(ole, PR_SENT_REPRESENTING_NAME),
      readString(ole, PR_SENT_REPRESENTING_EMAIL),
    ) ??
    transport.from;
  const subject = readString(ole, PR_SUBJECT) ?? transport.subject;
  const to = readString(ole, PR_DISPLAY_TO) ?? transport.to;
  const cc = readString(ole, PR_DISPLAY_CC) ?? transport.cc;
  const date =
    readFiletime(ole, PR_CLIENT_SUBMIT_TIME) ??
    readFiletime(ole, PR_MESSAGE_DELIVERY_TIME) ??
    transport.date;

  const doc = emptyDocument();
  doc.blocks.push(...headerBlocks({ subject, from, to, cc, date }));

  const html = readString(ole, PR_HTML);
  if (html !== undefined && trim(html).length > 0) {
    const blocks = htmlToBlocks(html);
    if (blocks.length > 0) doc.blocks.push(...blocks);
    else {
      const body = readString(ole, PR_BODY);
      if (body !== undefined) doc.blocks.push(...plainParagraphs(body));
    }
  } else {
    const body = readString(ole, PR_BODY);
    if (body !== undefined) doc.blocks.push(...plainParagraphs(body));
  }

  doc.blocks.push(...attachmentBlocks(attachmentNames(ole)));
  return doc;
}

function hasMsgEntries(ole: CompoundFile): boolean {
  for (const entry of ole.readRootStorage()) {
    if (isMsgName(entry.name)) return true;
  }
  return false;
}

function isMsgName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.startsWith('__substg1.0_') ||
    lower.startsWith('__properties_version1.0') ||
    lower.startsWith('__nameid_version1.0') ||
    lower.startsWith('__recip_version1.0_') ||
    lower.startsWith('__attach_version1.0_')
  );
}

function parseTransport(ole: CompoundFile): {
  subject?: string;
  from?: string;
  to?: string;
  cc?: string;
  date?: string;
} {
  const raw = readString(ole, PR_TRANSPORT_HEADERS);
  if (raw === undefined || trim(raw).length === 0) return {};
  const part = parseMime(new TextEncoder().encode(`${raw}\r\n\r\n`));
  return {
    subject: mimeHeader(part, 'subject'),
    from: mimeHeader(part, 'from'),
    to: mimeHeader(part, 'to'),
    cc: mimeHeader(part, 'cc'),
    date: mimeHeader(part, 'date'),
  };
}

function attachmentNames(ole: CompoundFile): string[] {
  const names: string[] = [];
  for (const entry of ole.readRootStorage()) {
    if (!entry.name.toLowerCase().startsWith('__attach_version1.0_')) continue;
    const prefix = `${entry.name}/`;
    const name =
      readString(ole, PR_ATTACH_LONG_FILENAME, prefix) ??
      readString(ole, PR_ATTACH_FILENAME, prefix) ??
      readString(ole, PR_DISPLAY_NAME, prefix);
    if (name !== undefined && trim(name).length > 0) names.push(name);
    else names.push('attachment');
  }
  return names;
}

function readString(ole: CompoundFile, prop: number, prefix = ''): string | undefined {
  const base = `${prefix}__substg1.0_${hex4(prop)}`;
  if (ole.exists(`${base}001F`)) return stripNul(decodeUtf16(ole.readStream(`${base}001F`)));
  if (ole.exists(`${base}001E`)) {
    return stripNul(decodeBytes(ole.readStream(`${base}001E`), 'windows-1252'));
  }
  if (ole.exists(`${base}0102`)) {
    return stripNul(decodeBytes(ole.readStream(`${base}0102`), 'utf-8'));
  }
  return undefined;
}

function readFiletime(ole: CompoundFile, prop: number): string | undefined {
  const name = `__substg1.0_${hex4(prop)}0040`;
  if (!ole.exists(name)) return undefined;
  const bytes = ole.readStream(name);
  if (bytes.length < 8) return undefined;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lo = BigInt(dv.getUint32(0, true));
  const hi = BigInt(dv.getUint32(4, true));
  const ms = Number((lo + (hi << 32n)) / 10000n) - FILETIME_EPOCH_MS;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toUTCString();
}

function formatAddress(name: string | undefined, email: string | undefined): string | undefined {
  const n = name !== undefined ? trim(name) : '';
  const e = email !== undefined ? trim(email) : '';
  if (n.length > 0 && e.length > 0 && n !== e) return `${n} <${e}>`;
  if (e.length > 0) return e;
  if (n.length > 0) return n;
  return undefined;
}

function decodeUtf16(bytes: Uint8Array): string {
  let end = bytes.length;
  if (end >= 2 && bytes[end - 2] === 0 && bytes[end - 1] === 0) end -= 2;
  return new TextDecoder('utf-16le').decode(bytes.subarray(0, end));
}

function stripNul(text: string): string {
  const z = text.indexOf('\0');
  return z < 0 ? text : text.slice(0, z);
}

function hex4(n: number): string {
  return n.toString(16).toUpperCase().padStart(4, '0');
}
