import { SINGLE_BYTE } from './single-byte.js';

const TEXT_DECODER: Record<string, string> = {
  utf8: 'utf-8',
  'utf-8': 'utf-8',
  'utf-16': 'utf-16le',
  'utf-16le': 'utf-16le',
  'utf16-le': 'utf-16le',
  'utf-16be': 'utf-16be',
  'utf16-be': 'utf-16be',
  'shift-jis': 'shift_jis',
  shiftjis: 'shift_jis',
  shift_jis: 'shift_jis',
  cp932: 'shift_jis',
  cp949: 'euc-kr',
  'euc-kr': 'euc-kr',
  'euc-jp': 'euc-jp',
  gbk: 'gbk',
  gb2312: 'gb2312',
  gb18030: 'gb18030',
  big5: 'big5',
  'iso-2022-jp': 'iso-2022-jp',
};

const ALIASES: Record<string, string> = {
  ...TEXT_DECODER,
  'cp-1252': 'windows-1252',
  cp1252: 'windows-1252',
  'latin-1': 'iso-8859-1',
  latin1: 'iso-8859-1',
  koi8r: 'koi8-r',
  ibm866: 'cp866',
};

const decoderCache = new Map<string, TextDecoder>();

function canon(label: string): string {
  const n = label.trim().toLowerCase();
  const dashed = n.replace(/_/g, '-');
  return ALIASES[n] ?? ALIASES[dashed] ?? dashed;
}

function tableFor(name: string): string | undefined {
  return SINGLE_BYTE[name] ?? SINGLE_BYTE[name.replace(/_/g, '-')];
}

function textDecoderLabel(name: string): string | undefined {
  return TEXT_DECODER[name] ?? TEXT_DECODER[name.replace(/_/g, '-')];
}

function getDecoder(label: string): TextDecoder | undefined {
  const cached = decoderCache.get(label);
  if (cached) return cached;
  try {
    const dec = new TextDecoder(label);
    decoderCache.set(label, dec);
    return dec;
  } catch {
    return undefined;
  }
}

function decodeTable(bytes: Uint8Array, table: string): string {
  const chunk = 4096;
  if (bytes.length <= chunk) {
    const codes = new Array<number>(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) codes[i] = table.charCodeAt(bytes[i]!);
    return String.fromCharCode(...codes);
  }
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunk) {
    const end = Math.min(i + chunk, bytes.length);
    const codes = new Array<number>(end - i);
    for (let j = i; j < end; j += 1) codes[j - i] = table.charCodeAt(bytes[j]!);
    parts.push(String.fromCharCode(...codes));
  }
  return parts.join('');
}

/** True if {@link decode} can handle this label. */
export function encodingExists(label: string): boolean {
  if (typeof label !== 'string' || label.length === 0) return false;
  const name = canon(label);
  if (tableFor(name) !== undefined) return true;
  const td = textDecoderLabel(name);
  if (td !== undefined) return getDecoder(td) !== undefined;
  return getDecoder(name) !== undefined;
}

/**
 * Decode `bytes` with a legacy or Unicode encoding.
 * Names match the previous iconv-lite labels used by the office converters.
 */
export function decode(bytes: Uint8Array, label: string): string {
  if (bytes.length === 0) return '';
  const name = canon(label);
  const table = tableFor(name);
  if (table !== undefined) return decodeTable(bytes, table);
  const td = textDecoderLabel(name) ?? name;
  const dec = getDecoder(td);
  if (dec === undefined) {
    throw new Error(`unsupported encoding: ${label}`);
  }
  return dec.decode(bytes);
}
