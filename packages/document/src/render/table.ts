import { lines, trim } from '@mdgate/utils';
import { type Block, type Cell, markerLabel, type Table } from '../model/index.js';
import type { Ctx } from './ctx.js';
import { escapeMarkerLabel } from './escape.js';
import { pushCodeSpan, renderInlines } from './inline.js';

export function renderTable(table: Table, rc: Ctx): string | undefined {
  if (table.grid.length === 0) return undefined;
  let rawWidth = 0;
  for (const row of table.grid) {
    if (row.length > rawWidth) rawWidth = row.length;
  }
  const texts: Array<string[] | null> = new Array(table.grid.length);
  const coveredFlags: boolean[][] = new Array(table.grid.length);
  for (let r = 0; r < table.grid.length; r += 1) {
    const row = table.grid[r]!;
    const t: string[] = new Array(rawWidth);
    const cov: boolean[] = new Array(rawWidth);
    for (let c = 0; c < row.length; c += 1) {
      const slot = row[c]!;
      if (slot.type === 'origin') {
        const cell = slot.cell;
        t[c] = cell.blocks.length === 0 ? '' : renderCell(cell, rc);
        cov[c] = false;
      } else {
        t[c] = '';
        cov[c] = true;
      }
    }
    for (let c = row.length; c < rawWidth; c += 1) {
      t[c] = '';
      cov[c] = false;
    }
    texts[r] = t;
    coveredFlags[r] = cov;
  }
  let nRows = texts.length;
  while (nRows > 1) {
    const last = texts[nRows - 1]!;
    const lastCov = coveredFlags[nRows - 1]!;
    let blank = true;
    for (let c = 0; c < rawWidth; c += 1) {
      if (last[c]!.length > 0 || lastCov[c]) {
        blank = false;
        break;
      }
    }
    if (!blank) break;
    nRows -= 1;
  }
  let width = 0;
  for (let r = 0; r < nRows; r += 1) {
    const t = texts[r]!;
    const cov = coveredFlags[r]!;
    for (let i = rawWidth - 1; i >= 0; i -= 1) {
      if (t[i]!.length > 0 || cov[i]) {
        if (i + 1 > width) width = i + 1;
        break;
      }
    }
  }
  if (width === 0) return undefined;

  let out = '';
  if (table.headerRows >= 1 && nRows > 0) {
    out += formatRow(texts[0]!, width);
    texts[0] = null;
  } else {
    out += emptyRow(width);
  }
  out += '\n';
  out += separatorRow(width);
  for (let r = 0; r < nRows; r += 1) {
    const t = texts[r];
    if (t === null) continue;
    out += '\n';
    out += formatRow(t, width);
  }
  return out;
}

function emptyRow(width: number): string {
  return `|${'  |'.repeat(width)}`;
}

function separatorRow(width: number): string {
  return `|${' --- |'.repeat(width)}`;
}

function formatRow(cells: readonly string[], width: number): string {
  let nonempty = 0;
  for (let i = 0; i < width; i += 1) {
    if (cells[i]!.length > 0) nonempty += 1;
  }
  if (nonempty === 0) return emptyRow(width);
  let s = '|';
  for (let i = 0; i < width; i += 1) {
    s += ' ';
    s += cells[i];
    s += ' |';
  }
  return s;
}

/** Flatten arbitrary block content into a single table-cell line. */
export function renderCell(cell: Cell, rc: Ctx): string {
  const parts: string[] = [];
  for (const block of cell.blocks) {
    cellBlockText(block, rc, parts);
  }
  return lines(parts.join('<br>'))
    .filter((l) => trim(l).length > 0)
    .map((l) => trim(l))
    .join('<br>');
}

function cellBlockText(block: Block, rc: Ctx, parts: string[]): void {
  switch (block.type) {
    case 'heading': {
      const t = renderInlines(block.content, 'tableCell', rc);
      if (trim(t).length > 0) parts.push(`**${trim(t)}**`);
      break;
    }
    case 'paragraph': {
      const t = renderInlines(block.inlines, 'tableCell', rc);
      if (trim(t).length > 0) parts.push(t);
      break;
    }
    case 'list':
      for (let i = 0; i < block.list.items.length; i += 1) {
        const item = block.list.items[i]!;
        const inner: string[] = [];
        for (const b of item.blocks) cellBlockText(b, rc, inner);
        let marker: string;
        if (item.markerLabel !== undefined) {
          marker = `${escapeMarkerLabel(item.markerLabel, 'tableCell')} `;
        } else if (block.list.marker === 'bullet') {
          marker = '• ';
        } else {
          marker = `${markerLabel(block.list.marker, saturatingAdd(block.list.start, i))} `;
        }
        if (inner.length > 0) parts.push(`${marker}${inner.join(' ')}`);
      }
      break;
    case 'table':
      for (const row of block.table.grid) {
        const cells = row.map((slot) => (slot.type === 'origin' ? renderCell(slot.cell, rc) : ''));
        if (cells.some((c) => c.length > 0)) parts.push(cells.join(' / '));
      }
      break;
    case 'blockQuote':
      for (const b of block.blocks) cellBlockText(b, rc, parts);
      break;
    case 'codeBlock': {
      const t = trim(block.text);
      if (t.length > 0) parts.push(pushCodeSpan(t));
      break;
    }
    case 'rule':
      break;
  }
}

function saturatingAdd(a: number, b: number): number {
  const s = a + b;
  return s > Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : s;
}
