import type { Block } from './block.js';
import { type Inline, inlinesAreEmpty } from './inline.js';

/**
 * Canonical table grid. Invariant: every logical grid position appears
 * exactly once — content and spans exist only on the origin slot, and each
 * position covered by a span holds a Covered marker pointing back at its
 * origin.
 */
export interface Table {
  grid: CellSlot[][];
  /** Number of leading rows that are header rows (0 = no header). */
  headerRows: number;
  kind: TableKind;
}

export type TableKind = 'data' | 'layout';

export type CellSlot =
  | { type: 'origin'; cell: Cell }
  | { type: 'covered'; originRow: number; originCol: number };

export interface Cell {
  blocks: Block[];
  colSpan: number;
  rowSpan: number;
}

export function newCell(blocks: Block[]): Cell {
  return { blocks, colSpan: 1, rowSpan: 1 };
}

export function cellFromInlines(inlines: Inline[]): Cell {
  return newCell([{ type: 'paragraph', inlines }]);
}

export function cellSpanning(blocks: Block[], colSpan: number, rowSpan: number): Cell {
  return { blocks, colSpan: Math.max(colSpan, 1), rowSpan: Math.max(rowSpan, 1) };
}

export function emptyCell(): Cell {
  return { blocks: [], colSpan: 0, rowSpan: 0 };
}

/**
 * True when the cell holds nothing that would render: only paragraphs count
 * toward emptiness, so a cell with a table or list in it is not empty even
 * if that content is blank.
 */
export function cellIsEmpty(cell: Cell): boolean {
  return cell.blocks.every((b) => b.type === 'paragraph' && inlinesAreEmpty(b.inlines));
}

/** Build a plain span-less table from rows of cells (spreadsheets, CSV). */
export function tableFromRows(rows: Cell[][], headerRows: number, kind: TableKind): Table {
  const b = new GridBuilder();
  for (const row of rows) {
    b.nextRow();
    for (const cell of row) {
      b.place({ ...cell, colSpan: 1, rowSpan: 1 });
    }
  }
  const table = b.finish(kind);
  table.headerRows = headerRows;
  return table;
}

/** True when the table is a single origin cell (any covered padding aside). */
export function tableIsSingleCell(table: Table): boolean {
  return (
    table.grid.length === 1 && table.grid[0]!.length === 1 && table.grid[0]![0]!.type === 'origin'
  );
}

function posKey(row: number, col: number): string {
  return `${row},${col}`;
}

const EMPTY_BLOCKS: Block[] = [];

function emptyOriginSlot(): CellSlot {
  return { type: 'origin', cell: { blocks: EMPTY_BLOCKS, colSpan: 1, rowSpan: 1 } };
}

/**
 * Sole constructor for Table grids. Enforces the exactly-once invariant:
 * spans register their covered positions, later placements skip over them,
 * and overlapping spans are clamped rather than double-counted.
 */
export class GridBuilder {
  private grid: CellSlot[][] = [];
  /** Positions in future rows covered by an earlier row-spanning origin. */
  private pending = new Map<string, [number, number]>();
  expansion = 0n;

  nextRow(): void {
    this.grid.push([]);
  }

  nextRows(n: number): void {
    for (let i = 0; i < n; i += 1) this.grid.push([]);
  }

  /**
   * Materialize `n` empty 1x1 origins on the current row. Used for ODF
   * interior empty-cell repeats so later content keeps source columns
   * without going through per-cell span accounting.
   */
  placeEmptyRun(n: number): void {
    if (n <= 0) return;
    const row = this.rowIndex();
    const line = this.grid[row]!;
    if (this.pending.size === 0) {
      const start = line.length;
      line.length = start + n;
      for (let i = 0; i < n; i += 1) line[start + i] = emptyOriginSlot();
      return;
    }
    for (let i = 0; i < n; i += 1) {
      this.skipPending(row);
      line.push(emptyOriginSlot());
    }
  }

  private rowIndex(): number {
    if (this.grid.length === 0) this.grid.push([]);
    return this.grid.length - 1;
  }

  /** Materialize pending covered positions at the cursor. */
  private skipPending(row: number): void {
    const line = this.grid[row]!;
    for (;;) {
      const origin = this.pending.get(posKey(row, line.length));
      if (origin === undefined) break;
      this.pending.delete(posKey(row, line.length));
      line.push({ type: 'covered', originRow: origin[0], originCol: origin[1] });
    }
  }

  place(cell: Cell): void {
    let colSpan0 = cell.colSpan > 1 ? cell.colSpan : 1;
    let rowSpan0 = cell.rowSpan > 1 ? cell.rowSpan : 1;
    if (colSpan0 > 10_000 || rowSpan0 > 10_000 || colSpan0 * rowSpan0 > 1_000_000) {
      colSpan0 = 1;
      rowSpan0 = 1;
    }
    if (colSpan0 === 1 && rowSpan0 === 1) {
      const row = this.rowIndex();
      this.skipPending(row);
      this.grid[row]!.push({
        type: 'origin',
        cell: { blocks: cell.blocks, colSpan: 1, rowSpan: 1 },
      });
      return;
    }
    const area = BigInt(colSpan0) * BigInt(rowSpan0);
    this.expansion += area - 1n;
    const row = this.rowIndex();
    this.skipPending(row);
    const col = this.grid[row]!.length;
    let colSpan = colSpan0;
    let rowSpan = rowSpan0;
    for (let dc = 1; dc < colSpan; dc += 1) {
      if (this.pending.has(posKey(row, col + dc))) {
        colSpan = dc;
        break;
      }
    }
    rows: for (let dr = 1; dr < rowSpan; dr += 1) {
      for (let dc = 0; dc < colSpan; dc += 1) {
        if (this.pending.has(posKey(row + dr, col + dc))) {
          rowSpan = dr;
          break rows;
        }
      }
    }
    this.grid[row]!.push({
      type: 'origin',
      cell: { ...cell, colSpan, rowSpan },
    });
    for (let dr = 0; dr < rowSpan; dr += 1) {
      for (let dc = 0; dc < colSpan; dc += 1) {
        if (dr === 0 && dc === 0) continue;
        this.pending.set(posKey(row + dr, col + dc), [row, col]);
      }
    }
  }

  /**
   * Consume one explicitly-written covered position (ODF covered-table-cell).
   * Returns false when no span accounts for the position — the stray marker
   * then becomes an empty cell.
   */
  covered(): boolean {
    const row = this.rowIndex();
    const col = this.grid[row]!.length;
    const origin = this.pending.get(posKey(row, col));
    if (origin !== undefined) {
      this.pending.delete(posKey(row, col));
      this.grid[row]!.push({ type: 'covered', originRow: origin[0], originCol: origin[1] });
      return true;
    }
    this.grid[row]!.push({ type: 'origin', cell: emptyCell() });
    return false;
  }

  finish(kind: TableKind): Table {
    const byRow = new Map<number, number[]>();
    for (const key of this.pending.keys()) {
      const comma = key.indexOf(',');
      const row = Number(key.slice(0, comma));
      const col = Number(key.slice(comma + 1));
      if (row < this.grid.length) {
        const cols = byRow.get(row);
        if (cols) cols.push(col);
        else byRow.set(row, [col]);
      }
    }
    for (const [row, cols] of byRow) {
      cols.sort((a, b) => a - b);
      const line = this.grid[row]!;
      for (const col of cols) {
        while (line.length < col) {
          line.push({ type: 'origin', cell: emptyCell() });
        }
        const origin = this.pending.get(posKey(row, col))!;
        this.pending.delete(posKey(row, col));
        line.push({ type: 'covered', originRow: origin[0], originCol: origin[1] });
      }
    }

    while (this.grid.length > 0) {
      const last = this.grid[this.grid.length - 1]!;
      const allEmpty = last.every((s) => (s.type === 'origin' ? cellIsEmpty(s.cell) : true));
      if (!allEmpty) break;
      this.grid.pop();
    }

    const rows = this.grid.length;
    for (let r = 0; r < rows; r += 1) {
      const width = this.grid[r]!.length;
      for (let c = 0; c < width; c += 1) {
        const slot = this.grid[r]![c]!;
        if (slot.type === 'origin') {
          const cs = slot.cell.colSpan;
          const rs = slot.cell.rowSpan;
          if (cs <= 1 && rs <= 1) continue;
          slot.cell.rowSpan = Math.min(rs, rows - r);
          slot.cell.colSpan = Math.min(cs, width - c);
        }
      }
    }
    return { grid: this.grid, headerRows: 0, kind };
  }
}
