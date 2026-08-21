import { lines, trim, trimEnd, trimEndMatches, trimStart } from '@mdgate/utils';
import {
  type Block,
  type Document,
  type Inline,
  inlinesAreEmpty,
  type List,
  markerLabel,
  type Note,
  tableIsSingleCell,
} from '../model/index.js';
import { resolveAnchors } from './anchors.js';
import type { Ctx } from './ctx.js';
import { backtickFence, escapeMarkerLabel } from './escape.js';
import { renderInlines } from './inline.js';
import { renderTable } from './table.js';

export { gfmSlug } from './anchors.js';
export type { Ctx } from './ctx.js';
export { escapeMarkerLabel } from './escape.js';

export function documentToMarkdown(doc: Document): string {
  const rc: Ctx = { nums: numberNotes(doc), anchors: resolveAnchors(doc) };
  const parts: string[] = [];
  for (const b of doc.blocks) {
    const rendered = renderBlock(b, rc);
    if (rendered !== undefined) parts.push(rendered);
  }
  const renderedDefs = new Set<number>();
  const ordered: Array<{ note: Note; num: number }> = [];
  for (const n of doc.notes) {
    const num = rc.nums.get(n.id);
    if (num !== undefined) ordered.push({ note: n, num });
  }
  ordered.sort((a, b) => a.num - b.num);
  for (const { note, num } of ordered) {
    const body = renderBlocks(note.blocks, rc);
    if (body.length === 0) continue;
    if (renderedDefs.has(num)) continue;
    renderedDefs.add(num);
    const bodyLines = lines(body);
    const first = bodyLines[0] ?? '';
    let s = `[^${num}]: ${first}`;
    for (let i = 1; i < bodyLines.length; i += 1) {
      const line = bodyLines[i]!;
      s += '\n';
      if (line.length > 0) {
        s += '    ';
        s += line;
      }
    }
    parts.push(s);
  }
  if (parts.length === 0) {
    for (const asset of doc.assets) {
      if (!asset.mediaType.startsWith('image/')) continue;
      parts.push('![]()');
    }
  }
  let out = parts.join('\n\n');
  if (out.length > 0) out += '\n';
  return out;
}

function numberNotes(doc: Document): Map<string, number> {
  const valid = new Map<string, Note>();
  for (const note of doc.notes) {
    if (!note.blocks.every(blockIsBlank) && !valid.has(note.id)) {
      valid.set(note.id, note);
    }
  }
  const order: string[] = [];
  const seen = new Set<string>();
  collectNoteRefs(doc.blocks, valid, order, seen);
  for (const note of doc.notes) {
    if (valid.has(note.id) && !seen.has(note.id)) {
      seen.add(note.id);
      order.push(note.id);
    }
  }
  const nums = new Map<string, number>();
  for (let i = 0; i < order.length; i += 1) nums.set(order[i]!, i + 1);
  return nums;
}

function blockIsBlank(block: Block): boolean {
  return block.type === 'paragraph' && inlinesAreEmpty(block.inlines);
}

function collectNoteRefs(
  blocks: readonly Block[],
  valid: Map<string, Note>,
  order: string[],
  seen: Set<string>,
): void {
  const walkInlines = (inlines: readonly Inline[]): void => {
    for (const inline of inlines) {
      if (inline.type === 'noteRef') {
        if (valid.has(inline.id) && !seen.has(inline.id)) {
          seen.add(inline.id);
          order.push(inline.id);
          collectNoteRefs(valid.get(inline.id)!.blocks, valid, order, seen);
        }
      } else if (inline.type === 'link') {
        walkInlines(inline.content);
      }
    }
  };
  for (const block of blocks) {
    switch (block.type) {
      case 'paragraph':
        walkInlines(block.inlines);
        break;
      case 'heading':
        walkInlines(block.content);
        break;
      case 'list':
        for (const item of block.list.items) collectNoteRefs(item.blocks, valid, order, seen);
        break;
      case 'table':
        for (const row of block.table.grid) {
          for (const slot of row) {
            if (slot.type === 'origin' && slot.cell.blocks.length > 0) {
              collectNoteRefs(slot.cell.blocks, valid, order, seen);
            }
          }
        }
        break;
      case 'blockQuote':
        collectNoteRefs(block.blocks, valid, order, seen);
        break;
      default:
        break;
    }
  }
}

function renderBlocks(blocks: readonly Block[], rc: Ctx): string {
  const parts: string[] = [];
  for (const b of blocks) {
    const rendered = renderBlock(b, rc);
    if (rendered !== undefined) parts.push(rendered);
  }
  return parts.join('\n\n');
}

function renderBlock(block: Block, rc: Ctx): string | undefined {
  switch (block.type) {
    case 'heading': {
      const text = trim(renderInlines(block.content, 'heading', rc));
      if (text.length === 0) return undefined;
      const level = Math.min(6, Math.max(1, block.level | 0));
      return `${'#'.repeat(level)} ${text}`;
    }
    case 'paragraph': {
      const text = renderInlines(block.inlines, 'block', rc);
      const trimmed = trimParagraph(text);
      return trimmed.length === 0 ? undefined : trimmed;
    }
    case 'list':
      return renderList(block.list, rc);
    case 'table':
      if (block.table.kind === 'layout' && tableIsSingleCell(block.table)) {
        const slot = block.table.grid[0]![0]!;
        if (slot.type !== 'origin') return undefined;
        const inner = renderBlocks(slot.cell.blocks, rc);
        return inner.length === 0 ? undefined : inner;
      }
      return renderTable(block.table, rc);
    case 'blockQuote': {
      const inner = renderBlocks(block.blocks, rc);
      if (inner.length === 0) return undefined;
      return lines(inner)
        .map((l) => (l.length === 0 ? '>' : `> ${l}`))
        .join('\n');
    }
    case 'codeBlock': {
      const fence = backtickFence(block.text, 3);
      const lang = block.lang ?? '';
      const body = trimEndMatches(block.text, '\n');
      return `${fence}${lang}\n${body}\n${fence}`;
    }
    case 'rule':
      return '---';
  }
}

function renderList(list: List, rc: Ctx): string | undefined {
  if (list.items.length === 0) return undefined;
  const renderedItems: string[] = [];
  let loose = false;
  for (let i = 0; i < list.items.length; i += 1) {
    const item = list.items[i]!;
    let marker: string;
    if (item.markerLabel !== undefined) {
      marker = `- ${escapeMarkerLabel(item.markerLabel, 'block')} `;
    } else if (list.marker === 'bullet') {
      marker = '- ';
    } else if (list.marker === 'decimal') {
      marker = `${saturatingAdd(list.start, i)}. `;
    } else {
      marker = `- ${markerLabel(list.marker, saturatingAdd(list.start, i))} `;
    }
    let checkbox = '';
    if (item.checked === true) checkbox = '[x] ';
    else if (item.checked === false) checkbox = '[ ] ';
    const body = renderBlocks(item.blocks, rc);
    if (item.blocks.length > 1) loose = true;
    const indent = ' '.repeat([...marker].length);
    const bodyLines = lines(body);
    const first = bodyLines[0] ?? '';
    let s = `${marker}${checkbox}${first}`;
    for (let li = 1; li < bodyLines.length; li += 1) {
      const line = bodyLines[li]!;
      s += '\n';
      if (line.length === 0) loose = true;
      else {
        s += indent;
        s += line;
      }
    }
    renderedItems.push(s);
  }
  return renderedItems.join(loose ? '\n\n' : '\n');
}

/** Trim paragraph lines, keeping hard-break backslashes intact. */
function trimParagraph(text: string): string {
  const trimmedLines = lines(text).map((l) => {
    let t = trimStart(l);
    if (!endsWithHardBreak(t)) t = trimEnd(t);
    return trim(trimEndMatches(t, '\\')).length === 0 ? '' : t;
  });
  const start = trimmedLines.findIndex((l) => l.length > 0);
  let end = -1;
  for (let i = trimmedLines.length - 1; i >= 0; i -= 1) {
    if (trimmedLines[i]!.length > 0) {
      end = i;
      break;
    }
  }
  if (start < 0 || end < 0) return '';
  let out = trimmedLines.slice(start, end + 1).join('\n');
  if (endsWithHardBreak(out)) {
    out = out.slice(0, out.length - 1);
    out = trimEnd(out);
  }
  return out;
}

function endsWithHardBreak(line: string): boolean {
  let n = 0;
  for (let i = line.length - 1; i >= 0; i -= 1) {
    if (line[i] === '\\') n += 1;
    else break;
  }
  return n % 2 === 1;
}

function saturatingAdd(a: number, b: number): number {
  const s = a + b;
  return s > Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : s;
}
