import type { Converter, ConvertHint, ConvertOptions, ConvertResult } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';
import { fileExtension } from '@mdgate/utils';
import { decodeText, toParagraphs, toSourceDoc } from './internal/parse.js';

const PLAIN_EXTS = new Set(['txt', 'text']);
const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdx']);
const SOURCE_EXTS = new Set([
  'js',
  'jsx',
  'ts',
  'tsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'c',
  'h',
  'cc',
  'cpp',
  'cs',
  'swift',
  'sh',
  'bash',
  'zsh',
  'sql',
  'css',
  'scss',
  'less',
  'graphql',
  'gv',
]);
const EXTS = new Set([...PLAIN_EXTS, ...MARKDOWN_EXTS, ...SOURCE_EXTS]);

export function text(): Converter {
  return {
    id: 'text',
    // Extension-only except UTF-8 BOM + printable when the path is .txt.
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      const ext = hint?.path !== undefined ? fileExtension(hint.path) : undefined;
      if (looksLikeGraphviz(decodeSniffText(bytes))) return 2;
      if (ext === 'txt' && hasUtf8Bom(bytes) && isPrintableUtf8(bytes.subarray(3))) return 2;
      if (ext !== undefined && EXTS.has(ext)) return 1;
      return 0;
    },
    convert(bytes: Uint8Array, options?: ConvertOptions): ConvertResult {
      refuseForeign(bytes);
      const decoded = decodeText(bytes);
      if (looksLikeGraphviz(decoded)) {
        return { markdown: documentToMarkdown(toSourceDoc(decoded, 'dot')) };
      }
      const ext = options?.path !== undefined ? fileExtension(options.path) : undefined;
      if (ext === undefined || !EXTS.has(ext)) {
        throw ConvertError.unsupported(ext ?? 'text');
      }
      if (MARKDOWN_EXTS.has(ext)) {
        return { markdown: decoded.endsWith('\n') ? decoded : `${decoded}\n` };
      }
      if (PLAIN_EXTS.has(ext)) {
        return { markdown: documentToMarkdown(toParagraphs(decoded)) };
      }
      return { markdown: documentToMarkdown(toSourceDoc(decoded, ext)) };
    },
  };
}

function refuseForeign(bytes: Uint8Array): void {
  const start =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? bytes.subarray(3)
      : bytes;
  if (startsWith(start, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    throw ConvertError.unsupported('pdf');
  }
  if (startsWith(start, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    throw ConvertError.unsupported('ole');
  }
  if (startsWith(start, [0x50, 0x4b, 0x03, 0x04])) {
    throw ConvertError.unsupported('zip');
  }
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}

function isPrintableUtf8(bytes: Uint8Array): boolean {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    for (let i = 0; i < text.length; i += 1) {
      const c = text.charCodeAt(i);
      if (c === 9 || c === 10 || c === 13) continue;
      if (c < 0x20 || c === 0x7f) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i += 1) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

function decodeSniffText(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8').decode(bytes.subarray(0, 8192));
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeGraphviz(text: string): boolean {
  const end = Math.min(text.length, 8192);
  let i = 0;

  const skip = (): void => {
    while (i < end) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) {
        i += 1;
        continue;
      }
      if (c === 35) {
        i += 1;
        while (i < end && text.charCodeAt(i) !== 10) i += 1;
        continue;
      }
      if (c === 47 && i + 1 < end) {
        const next = text.charCodeAt(i + 1);
        if (next === 47) {
          i += 2;
          while (i < end && text.charCodeAt(i) !== 10) i += 1;
          continue;
        }
        if (next === 42) {
          i += 2;
          while (i + 1 < end && !(text.charCodeAt(i) === 42 && text.charCodeAt(i + 1) === 47)) {
            i += 1;
          }
          i = i + 1 < end ? i + 2 : end;
          continue;
        }
      }
      break;
    }
  };

  const takeWord = (word: string): boolean => {
    if (i + word.length > end) return false;
    if (text.slice(i, i + word.length).toLowerCase() !== word) return false;
    const after = i + word.length;
    if (after < end) {
      const c = text.charCodeAt(after);
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95) {
        return false;
      }
    }
    i += word.length;
    return true;
  };

  skip();
  if (takeWord('strict')) skip();
  if (!takeWord('digraph') && !takeWord('graph')) return false;
  skip();
  if (i >= end) return false;
  if (text[i] === '{') return true;
  if (text[i] === '"') {
    i += 1;
    while (i < end) {
      if (text[i] === '\\') {
        i += 2;
        continue;
      }
      if (text[i] === '"') {
        i += 1;
        break;
      }
      i += 1;
    }
    skip();
    return text[i] === '{';
  }
  if (text[i] === '<') {
    i += 1;
    let depth = 1;
    while (i < end && depth > 0) {
      if (text[i] === '<') depth += 1;
      else if (text[i] === '>') depth -= 1;
      i += 1;
    }
    skip();
    return text[i] === '{';
  }
  while (i < end) {
    const c = text.charCodeAt(i);
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 123) break;
    i += 1;
  }
  skip();
  return text[i] === '{';
}
