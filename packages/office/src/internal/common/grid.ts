import { type Block, type Cell, cellSpanning, GridBuilder } from '../model/index.js';
import { resolveHeaderRows } from './header.js';

/** Merge/boundary properties of one cell. */
export interface CellProp {
  mergeFirst: boolean;
  mergeCont: boolean;
  vmergeFirst: boolean;
  vmergeCont: boolean;
  /** Right boundary in twips. */
  right: number;
}

export function emptyCellProp(): CellProp {
  return {
    mergeFirst: false,
    mergeCont: false,
    vmergeFirst: false,
    vmergeCont: false,
    right: 0,
  };
}

/** One logical row: its cells with their properties, and whether it is a header. */
export interface GridRow {
  cells: Array<[Block[], CellProp]>;
  header: boolean;
}

interface Origin {
  blocks: Block[];
  colL: number;
  colR: number;
  rowSpan: number;
  vmergeFirst: boolean;
  covered: boolean;
}

/** Assemble logical rows into the canonical grid. */
export function buildEdgeTable(rowsIn: GridRow[]): Block | undefined {
  const EDGE_TOLERANCE = 10;
  const headerRows = countLeading(rowsIn, (r) => r.header);

  const rowsEdged: Array<Array<[Block[], CellProp]>> = rowsIn.map((row) => {
    let last = Number.NEGATIVE_INFINITY;
    return row.cells.map(([blocks, prop]) => {
      const next = { ...prop };
      if (next.right <= last) next.right = last + 1;
      last = next.right;
      return [blocks, next] as [Block[], CellProp];
    });
  });

  const edges: number[] = [];
  for (const row of rowsEdged) {
    for (const [, prop] of row) edges.push(prop.right);
  }
  edges.sort((a, b) => a - b);
  const clusters: number[] = [];
  for (const e of edges) {
    const last = clusters[clusters.length - 1];
    if (last === undefined || e - last > EDGE_TOLERANCE) clusters.push(e);
  }
  const colOf = (x: number): number => {
    let lo = 0;
    let hi = clusters.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (clusters[mid]! < x - EDGE_TOLERANCE) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const rows: Origin[][] = [];
  for (const row of rowsEdged) {
    const out: Origin[] = [];
    let col = 0;
    let i = 0;
    while (i < row.length) {
      const [blocks, prop] = row[i]!;
      i += 1;
      let mergedBlocks = blocks;
      let right = prop.right;
      if (prop.mergeFirst) {
        while (i < row.length && row[i]![1].mergeCont) {
          const [b, p] = row[i]!;
          i += 1;
          mergedBlocks = mergedBlocks.concat(b);
          right = p.right;
        }
      }
      const colR = Math.max(colOf(right) + 1, col + 1);
      out.push({
        blocks: mergedBlocks,
        colL: col,
        colR,
        rowSpan: 1,
        vmergeFirst: prop.vmergeFirst,
        covered: prop.vmergeCont,
      });
      col = colR;
    }
    rows.push(out);
  }

  const rangeKey = (l: number, r: number): string => `${l},${r}`;
  let active = new Map<string, [number, number]>();
  for (let r = 0; r < rows.length; r += 1) {
    const nextActive = new Map<string, [number, number]>();
    for (let i = 0; i < rows[r]!.length; i += 1) {
      const cell = rows[r]![i]!;
      const key = rangeKey(cell.colL, cell.colR);
      if (cell.covered) {
        const origin = active.get(key);
        if (origin !== undefined) {
          rows[origin[0]]![origin[1]]!.rowSpan += 1;
          nextActive.set(key, origin);
          continue;
        }
        cell.covered = false;
      }
      if (cell.vmergeFirst) nextActive.set(key, [r, i]);
    }
    active = nextActive;
  }

  const builder = new GridBuilder();
  for (const row of rows) {
    builder.nextRow();
    for (const origin of row) {
      const span = origin.colR - origin.colL;
      if (origin.covered) {
        for (let k = 0; k < span; k += 1) builder.covered();
      } else {
        builder.place(cellSpanning(origin.blocks, span, origin.rowSpan));
      }
    }
  }
  const table = builder.finish('data');
  if (table.grid.length === 0) return undefined;
  table.headerRows = resolveHeaderRows(table, headerRows);
  return { type: 'table', table };
}

function countLeading<T>(items: T[], pred: (t: T) => boolean): number {
  let n = 0;
  for (const item of items) {
    if (!pred(item)) break;
    n += 1;
  }
  return n;
}

export type { Cell };
