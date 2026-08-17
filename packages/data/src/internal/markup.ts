import type { Document } from '@mdgate/document';
import { fencedDocument } from './doc.js';

export function xmlDocument(text: string): Document {
  return fencedDocument('xml', prettyXml(text));
}

export function yamlDocument(text: string): Document {
  return fencedDocument('yaml', text.trimEnd());
}

function prettyXml(src: string): string {
  const trimmed = src.trim();
  if (trimmed.length === 0) return '';
  const tokens = tokenizeXml(trimmed);
  const lines: string[] = [];
  let indent = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]!;
    const kind = tagKind(tok);
    if (kind === 'text') {
      const text = tok.trim();
      if (text.length === 0) continue;
      const next = tokens[i + 1];
      const prev = tokens[i - 1];
      if (
        next !== undefined &&
        prev !== undefined &&
        tagKind(prev) === 'open' &&
        tagKind(next) === 'close' &&
        !text.includes('\n')
      ) {
        const last = lines.pop();
        lines.push(`${last ?? `${pad(indent)}${prev}`}${text}${next}`);
        i += 1;
        indent = Math.max(0, indent - 1);
        continue;
      }
      for (const line of text.split(/\r?\n/)) {
        const piece = line.trim();
        if (piece.length > 0) lines.push(`${pad(indent)}${piece}`);
      }
      continue;
    }
    if (kind === 'close') {
      indent = Math.max(0, indent - 1);
      lines.push(`${pad(indent)}${tok}`);
      continue;
    }
    lines.push(`${pad(indent)}${tok}`);
    if (kind === 'open') indent += 1;
  }
  return lines.join('\n');
}

function tokenizeXml(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (s.charCodeAt(i) !== 0x3c) {
      const j = s.indexOf('<', i);
      const end = j < 0 ? s.length : j;
      out.push(s.slice(i, end));
      i = end;
      continue;
    }
    if (s.startsWith('<!--', i)) {
      const j = s.indexOf('-->', i + 4);
      const end = j < 0 ? s.length : j + 3;
      out.push(s.slice(i, end));
      i = end;
      continue;
    }
    if (s.startsWith('<![CDATA[', i)) {
      const j = s.indexOf(']]>', i + 9);
      const end = j < 0 ? s.length : j + 3;
      out.push(s.slice(i, end));
      i = end;
      continue;
    }
    const j = s.indexOf('>', i + 1);
    const end = j < 0 ? s.length : j + 1;
    out.push(s.slice(i, end));
    i = end;
  }
  return out;
}

function tagKind(tok: string): 'open' | 'close' | 'empty' | 'misc' | 'text' {
  if (tok.charCodeAt(0) !== 0x3c) return 'text';
  if (tok.startsWith('</')) return 'close';
  if (tok.startsWith('<?') || tok.startsWith('<!')) return 'misc';
  if (tok.endsWith('/>')) return 'empty';
  return 'open';
}

function pad(n: number): string {
  return '  '.repeat(n);
}
