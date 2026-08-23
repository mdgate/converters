import { ConvertError } from '@mdgate/core';
import {
  type Document,
  emptyDocument,
  heading,
  type Inline,
  type ListItem,
  PLAIN,
  plain,
} from '@mdgate/document';

const CODE_STYLE = { bold: false, italic: false, strike: false, code: true } as const;

export function looksLikeNotebook(bytes: Uint8Array): boolean {
  const text = decodeUtf8(bytes, false);
  if (text === undefined) return false;
  try {
    return isNotebook(JSON.parse(text) as unknown);
  } catch {
    return false;
  }
}

export function parse(bytes: Uint8Array): Document {
  const text = decodeUtf8(bytes, true);
  if (text === undefined) throw ConvertError.malformed('invalid UTF-8');
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw ConvertError.malformed('invalid JSON');
  }
  if (!isNotebook(value)) throw ConvertError.malformed('not a Jupyter notebook');
  return notebookToDocument(value);
}

function decodeUtf8(bytes: Uint8Array, fatal: boolean): string | undefined {
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    start = 3;
  }
  try {
    return new TextDecoder('utf-8', { fatal }).decode(bytes.subarray(start));
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNotebook(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || typeof value.nbformat !== 'number') return false;
  if (Array.isArray(value.cells)) return true;
  return Array.isArray(value.worksheets);
}

function notebookCells(nb: Record<string, unknown>): unknown[] {
  if (Array.isArray(nb.cells)) return nb.cells;
  if (!Array.isArray(nb.worksheets)) return [];
  const cells: unknown[] = [];
  for (const ws of nb.worksheets) {
    if (!isRecord(ws) || !Array.isArray(ws.cells)) continue;
    for (const cell of ws.cells) cells.push(cell);
  }
  return cells;
}

function cellSource(cell: Record<string, unknown>): string {
  if (cell.source !== undefined) return joinSource(cell.source);
  return joinSource(cell.input);
}

function notebookToDocument(nb: Record<string, unknown>): Document {
  const lang = notebookLanguage(nb);
  const doc = emptyDocument();
  for (const cell of notebookCells(nb)) {
    if (!isRecord(cell)) continue;
    const kind = typeof cell.cell_type === 'string' ? cell.cell_type : '';
    if (kind === 'markdown' || kind === 'raw') {
      pushMarkdown(doc, cellSource(cell));
    } else if (kind === 'code') {
      pushCode(doc, cellSource(cell), lang);
      if (Array.isArray(cell.outputs)) pushOutputs(doc, cell.outputs);
    } else if (kind === 'heading') {
      const level = typeof cell.level === 'number' ? cell.level : 1;
      const text = cellSource(cell).trim();
      if (text.length > 0) doc.blocks.push(heading(level, parseInlines(text)));
    }
  }
  return doc;
}

function notebookLanguage(nb: Record<string, unknown>): string {
  const meta = isRecord(nb.metadata) ? nb.metadata : undefined;
  if (meta !== undefined) {
    const info = isRecord(meta.language_info) ? meta.language_info : undefined;
    if (info !== undefined && typeof info.name === 'string' && info.name.trim().length > 0) {
      return info.name.trim();
    }
    const spec = isRecord(meta.kernelspec) ? meta.kernelspec : undefined;
    if (
      spec !== undefined &&
      typeof spec.language === 'string' &&
      spec.language.trim().length > 0
    ) {
      return spec.language.trim();
    }
  }
  return 'python';
}

function joinSource(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  let out = '';
  for (const part of value) {
    if (typeof part === 'string') out += part;
  }
  return out;
}

function pushCode(doc: Document, source: string, lang: string): void {
  const text = trimEndNewline(source);
  if (text.length === 0) return;
  doc.blocks.push({ type: 'codeBlock', lang, text });
}

function pushOutputs(doc: Document, outputs: unknown[]): void {
  for (const output of outputs) {
    if (!isRecord(output)) continue;
    const kind = typeof output.output_type === 'string' ? output.output_type : '';
    if (kind === 'stream') {
      pushPlainOutput(doc, joinSource(output.text));
      continue;
    }
    if (kind === 'error') {
      const tb = Array.isArray(output.traceback)
        ? output.traceback.filter((line): line is string => typeof line === 'string').join('\n')
        : '';
      const fallback = [output.ename, output.evalue]
        .filter((part): part is string => typeof part === 'string' && part.length > 0)
        .join(': ');
      pushPlainOutput(doc, tb.length > 0 ? tb : fallback);
      continue;
    }
    if (kind !== 'execute_result' && kind !== 'display_data' && kind !== 'update_display_data') {
      continue;
    }
    const data = isRecord(output.data) ? output.data : undefined;
    if (data === undefined) continue;
    if (data['text/markdown'] !== undefined) {
      pushMarkdown(doc, joinSource(data['text/markdown']));
    }
    if (data['text/plain'] !== undefined) {
      pushPlainOutput(doc, joinSource(data['text/plain']));
    }
    if (data['image/png'] !== undefined) {
      doc.blocks.push({
        type: 'paragraph',
        inlines: [
          { type: 'image', alt: 'image/png', source: { type: 'external', url: 'image.png' } },
        ],
      });
    }
  }
}

function pushPlainOutput(doc: Document, raw: string): void {
  const text = trimEndNewline(stripAnsi(raw));
  if (text.length === 0) return;
  doc.blocks.push({ type: 'codeBlock', lang: undefined, text });
}

function stripAnsi(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 0x1b && text[i + 1] === '[') {
      i += 2;
      while (i < text.length) {
        const c = text.charCodeAt(i);
        if (c >= 0x40 && c <= 0x7e) break;
        i += 1;
      }
      continue;
    }
    out += text[i];
  }
  return out;
}

function trimEndNewline(text: string): string {
  return text.endsWith('\n') ? text.slice(0, text.endsWith('\r\n') ? -2 : -1) : text;
}

function pushMarkdown(doc: Document, source: string): void {
  const text = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (text.trim().length === 0) return;
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim().length === 0) {
      i += 1;
      continue;
    }
    const fence = line.match(/^(```+|~~~+)(.*)$/);
    if (fence !== null) {
      const mark = fence[1]!;
      const lang = fence[2]!.trim();
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.startsWith(mark)) {
        body.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1;
      doc.blocks.push({
        type: 'codeBlock',
        lang: lang.length > 0 ? lang : undefined,
        text: body.join('\n'),
      });
      continue;
    }
    const atx = line.match(/^(#{1,6})[ \t]+(.*)$/);
    if (atx !== null) {
      const title = atx[2]!.replace(/[ \t]+#*[ \t]*$/, '').trim();
      if (title.length > 0) doc.blocks.push(heading(atx[1]!.length, parseInlines(title)));
      i += 1;
      continue;
    }
    if (isThematicBreak(line)) {
      doc.blocks.push({ type: 'rule' });
      i += 1;
      continue;
    }
    if (/^>[ \t]?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>[ \t]?/.test(lines[i]!)) {
        quoted.push(lines[i]!.replace(/^>[ \t]?/, ''));
        i += 1;
      }
      const inner = emptyDocument();
      pushMarkdown(inner, quoted.join('\n'));
      if (inner.blocks.length > 0) doc.blocks.push({ type: 'blockQuote', blocks: inner.blocks });
      continue;
    }
    if (isListItem(line)) {
      i = pushList(doc, lines, i);
      continue;
    }
    const para: string[] = [line];
    i += 1;
    while (i < lines.length && lines[i]!.trim().length > 0 && !isBlockStart(lines[i]!)) {
      para.push(lines[i]!);
      i += 1;
    }
    doc.blocks.push({ type: 'paragraph', inlines: parseInlines(para.join('\n')) });
  }
}

function isThematicBreak(line: string): boolean {
  const t = line.trim();
  return /^(\*[ \t]*){3,}$/.test(t) || /^(-[ \t]*){3,}$/.test(t) || /^(_[ \t]*){3,}$/.test(t);
}

function isListItem(line: string): boolean {
  return /^\s*(?:[-*+]|\d+[.)])\s+\S/.test(line);
}

function isBlockStart(line: string): boolean {
  return (
    /^(```+|~~~+)/.test(line) ||
    /^#{1,6}[ \t]+/.test(line) ||
    isThematicBreak(line) ||
    /^>[ \t]?/.test(line) ||
    isListItem(line)
  );
}

function pushList(doc: Document, lines: readonly string[], start: number): number {
  const ordered = /^\s*\d+[.)]\s+\S/.test(lines[start]!);
  const itemRe = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
  const items: ListItem[] = [];
  let i = start;
  while (i < lines.length) {
    const match = lines[i]!.match(itemRe);
    if (match === null) break;
    items.push({
      blocks: [{ type: 'paragraph', inlines: parseInlines(match[1]!) }],
      checked: undefined,
      markerLabel: undefined,
    });
    i += 1;
  }
  if (items.length > 0) {
    doc.blocks.push({
      type: 'list',
      list: { marker: ordered ? 'decimal' : 'bullet', start: 1, items },
    });
  }
  return i;
}

function parseInlines(text: string): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  let i = 0;
  const flush = (): void => {
    if (buf.length === 0) return;
    out.push(plain(buf));
    buf = '';
  };
  while (i < text.length) {
    if (text.startsWith('![', i)) {
      const link = matchLink(text, i + 1);
      if (link !== undefined) {
        flush();
        out.push({ type: 'image', alt: link.label, source: { type: 'external', url: link.url } });
        i = link.end;
        continue;
      }
    }
    if (text[i] === '[') {
      const link = matchLink(text, i);
      if (link !== undefined) {
        flush();
        out.push({
          type: 'link',
          content: [plain(link.label)],
          target: { type: 'external', url: link.url },
        });
        i = link.end;
        continue;
      }
    }
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: 'text', text: text.slice(i + 1, end), style: CODE_STYLE });
        i = end + 1;
        continue;
      }
    }
    if (text.startsWith('**', i) || text.startsWith('__', i)) {
      const mark = text.slice(i, i + 2);
      const end = text.indexOf(mark, i + 2);
      if (end > i + 2) {
        flush();
        out.push({
          type: 'text',
          text: text.slice(i + 2, end),
          style: { ...PLAIN, bold: true },
        });
        i = end + 2;
        continue;
      }
    }
    buf += text[i];
    i += 1;
  }
  flush();
  return out.length > 0 ? out : [plain('')];
}

function matchLink(
  text: string,
  openBracket: number,
): { label: string; url: string; end: number } | undefined {
  if (text[openBracket] !== '[') return undefined;
  const close = text.indexOf(']', openBracket + 1);
  if (close < 0 || text[close + 1] !== '(') return undefined;
  const urlEnd = text.indexOf(')', close + 2);
  if (urlEnd < 0) return undefined;
  return {
    label: text.slice(openBracket + 1, close),
    url: text.slice(close + 2, urlEnd),
    end: urlEnd + 1,
  };
}
