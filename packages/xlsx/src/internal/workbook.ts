import { ConvertError } from '@mdgate/core';
import {
  type CellSlot,
  type Document,
  emptyDocument,
  heading,
  MAX_EXPANSION,
  plain,
  resolveHeaderRows,
} from '@mdgate/document';
import { warn } from '@mdgate/utils';
import { type CellValue, EMPTY, formatData } from './values.js';

export interface MergeRegion {
  /** Inclusive 0-based start (row, col). */
  start: [number, number];
  /** Inclusive 0-based end (row, col). */
  end: [number, number];
}

export interface SparseCell {
  row: number;
  col: number;
  value: CellValue;
}

export interface SheetRange {
  name: string;
  start: [number, number];
  height: number;
  width: number;
  values: CellValue[];
  merges: MergeRegion[];
}

/** Build a dense used-range from non-empty cells. */
export function fromSparse(cells: SparseCell[]):
  | {
      start: [number, number];
      height: number;
      width: number;
      values: CellValue[];
    }
  | undefined {
  if (cells.length === 0) return undefined;
  let rowStart = Number.POSITIVE_INFINITY;
  let rowEnd = 0;
  let colStart = Number.POSITIVE_INFINITY;
  let colEnd = 0;
  for (const c of cells) {
    if (c.row < rowStart) rowStart = c.row;
    if (c.row > rowEnd) rowEnd = c.row;
    if (c.col < colStart) colStart = c.col;
    if (c.col > colEnd) colEnd = c.col;
  }
  const width = colEnd - colStart + 1;
  const height = rowEnd - rowStart + 1;
  const values: CellValue[] = new Array<CellValue>(width * height).fill(EMPTY);
  for (const c of cells) {
    const idx = (c.row - rowStart) * width + (c.col - colStart);
    if (idx >= 0 && idx < values.length) values[idx] = c.value;
  }
  return { start: [rowStart, colStart], height, width, values };
}

/** Convert opened sheet ranges into a document. */
export function sheetsToDocument(sheets: SheetRange[]): Document {
  const doc = emptyDocument();
  const multiSheet = sheets.length > 1;
  let failed = 0;
  let attempted = 0;
  for (const sheet of sheets) {
    attempted += 1;
    if (sheet.height === 0 || sheet.width === 0 || sheet.values.length === 0) continue;
    try {
      const table = sheetToTable(sheet);
      if (table === undefined) continue;
      if (multiSheet) {
        doc.blocks.push(heading(2, [plain(sheet.name)]));
      }
      doc.blocks.push({ type: 'table', table });
    } catch (e) {
      if (e instanceof ConvertError && e.isFatal()) throw e;
      warn(
        `skipping unreadable sheet ${JSON.stringify(sheet.name)}: ${e instanceof Error ? e.message : String(e)}`,
      );
      failed += 1;
    }
  }
  if (attempted > 0 && failed === attempted && doc.blocks.length === 0) {
    throw ConvertError.malformed('no sheet in the workbook could be read');
  }
  return doc;
}

function sheetToTable(sheet: SheetRange) {
  const { start, height, width, values, merges } = sheet;
  const origins = merges.length > 0 ? new Map<number, [number, number]>() : undefined;
  const covered = merges.length > 0 ? new Map<number, [number, number]>() : undefined;
  if (origins !== undefined && covered !== undefined) {
    let expansion = 0n;
    for (const d of merges) {
      const row0 = Math.max(d.start[0], start[0]);
      const col0 = Math.max(d.start[1], start[1]);
      const rowEnd = Math.min(d.end[0] + 1, start[0] + height);
      const colEnd = Math.min(d.end[1] + 1, start[1] + width);
      if (row0 >= rowEnd || col0 >= colEnd) continue;
      const r0 = row0 - start[0];
      const c0 = col0 - start[1];
      const r1 = rowEnd - start[0];
      const c1 = colEnd - start[1];
      if (r1 - r0 === 1 && c1 - c0 === 1) continue;
      const colSpan = c1 - c0;
      const rowSpan = r1 - r0;
      expansion += BigInt(colSpan) * BigInt(rowSpan) - 1n;
      if (expansion > BigInt(MAX_EXPANSION)) {
        throw ConvertError.resourceLimit(
          'max_expansion',
          'table span expansion exceeds the content budget',
        );
      }
      origins.set(posKey(r0, c0), [colSpan, rowSpan]);
      for (let r = r0; r < r1; r += 1) {
        for (let c = c0; c < c1; c += 1) {
          if (r !== r0 || c !== c0) covered.set(posKey(r, c), [r0, c0]);
        }
      }
    }
  }

  const grid: CellSlot[][] = new Array(height);
  for (let r = 0; r < height; r += 1) {
    const row: CellSlot[] = new Array(width);
    const rowOff = r * width;
    for (let c = 0; c < width; c += 1) {
      const origin = covered?.get(posKey(r, c));
      if (origin !== undefined) {
        row[c] = { type: 'covered', originRow: origin[0], originCol: origin[1] };
        continue;
      }
      const data = values[rowOff + c] ?? EMPTY;
      const text = data.kind === 'empty' ? '' : formatData(data);
      const span = origins?.get(posKey(r, c));
      row[c] = {
        type: 'origin',
        cell: {
          blocks: text.length === 0 ? [] : [{ type: 'paragraph', inlines: [plain(text)] }],
          colSpan: span?.[0] ?? 1,
          rowSpan: span?.[1] ?? 1,
        },
      };
    }
    grid[r] = row;
  }

  while (grid.length > 0) {
    const last = grid[grid.length - 1]!;
    const allEmpty = last.every((s) => s.type !== 'origin' || s.cell.blocks.length === 0);
    if (!allEmpty) break;
    grid.pop();
  }
  if (grid.length === 0) return undefined;
  const table = { grid, headerRows: 0, kind: 'data' as const };
  table.headerRows = resolveHeaderRows(table, 0);
  return table;
}

function posKey(r: number, c: number): number {
  return r * 65536 + c;
}
