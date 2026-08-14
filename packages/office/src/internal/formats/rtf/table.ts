/** RTF table assembly: cell properties at `\cellx`, rows per `\itap` depth. */

import { type BlockStyle, StyledRun } from '../../common/blockstyle.js';
import { buildEdgeTable, type CellProp, emptyCellProp, type GridRow } from '../../common/grid.js';
import { type Block, type Inline, inlinesAreEmpty } from '../../model/index.js';

interface RowBuild {
  cells: Array<[Block[], CellProp]>;
  header: boolean;
}

interface TableBuild {
  rows: RowBuild[];
  rowProps: CellProp[];
  propCursor: number;
  pendingProp: CellProp;
  row: RowBuild;
  rowHeader: boolean;
}

function emptyRow(): RowBuild {
  return { cells: [], header: false };
}

function emptyTableBuild(): TableBuild {
  return {
    rows: [],
    rowProps: [],
    propCursor: 0,
    pendingProp: emptyCellProp(),
    row: emptyRow(),
    rowHeader: false,
  };
}

function copyProp(p: CellProp): CellProp {
  return {
    mergeFirst: p.mergeFirst,
    mergeCont: p.mergeCont,
    vmergeFirst: p.vmergeFirst,
    vmergeCont: p.vmergeCont,
    right: p.right,
  };
}

/** Table builders indexed by nesting depth - 1, plus per-depth pending cell content. */
export class TableState {
  private tables: TableBuild[] = [];
  private cellBlocks: Block[][] = [[]];
  private cellRuns: StyledRun[] = [new StyledRun()];

  /** Deepest depth with a builder allocated. */
  depth(): number {
    return this.tables.length;
  }

  private tableAt(depth: number): TableBuild {
    while (this.tables.length < depth) this.tables.push(emptyTableBuild());
    this.ensureCellDepth(depth);
    return this.tables[depth - 1]!;
  }

  private ensureCellDepth(depth: number): void {
    while (this.cellBlocks.length < depth) this.cellBlocks.push([]);
    while (this.cellRuns.length < depth) this.cellRuns.push(new StyledRun());
  }

  private cellBlockAt(depth: number): Block[] {
    this.ensureCellDepth(depth);
    return this.cellBlocks[depth - 1]!;
  }

  private flushCellRun(depth: number): void {
    this.ensureCellDepth(depth);
    this.cellRuns[depth - 1]!.flush(this.cellBlocks[depth - 1]!);
  }

  /** `\trowd`: reset the row's declared properties. */
  beginRow(depth: number): void {
    const t = this.tableAt(depth);
    t.rowProps = [];
    t.propCursor = 0;
    t.pendingProp = emptyCellProp();
    t.rowHeader = false;
  }

  /** `\trhdr`: the row repeats as a header. */
  markHeaderRow(depth: number): void {
    this.tableAt(depth).rowHeader = true;
  }

  /** The property slot the next `\cellx` will seal. */
  pendingProp(depth: number): CellProp {
    return this.tableAt(depth).pendingProp;
  }

  /** `\cellxN`: seal the pending properties with the right boundary. */
  declareCell(depth: number, right: number): void {
    const t = this.tableAt(depth);
    const prop = t.pendingProp;
    t.pendingProp = emptyCellProp();
    prop.right = right;
    t.rowProps.push(prop);
  }

  /** A paragraph ended inside a cell at `depth`. */
  pushCellParagraph(depth: number, style: BlockStyle | undefined, inlines: Inline[]): void {
    this.ensureCellDepth(depth);
    const blocks = this.cellBlocks[depth - 1]!;
    const run = this.cellRuns[depth - 1]!;
    if (style !== undefined) {
      run.push(style, inlines, blocks);
    } else {
      run.flush(blocks);
      if (!inlinesAreEmpty(inlines)) {
        blocks.push({ type: 'paragraph', inlines });
      }
    }
  }

  /** Whether unfinished cell content is pending at `depth`. */
  hasPendingCell(depth: number): boolean {
    this.flushCellRun(depth);
    return this.cellBlockAt(depth).length > 0;
  }

  /**
   * Whether a row at `depth` is partially built (pending cell content or
   * already-closed cells awaiting their `\row`).
   */
  hasPartialRow(depth: number): boolean {
    const t = this.tables[depth - 1];
    return this.hasPendingCell(depth) || (t !== undefined && t.row.cells.length > 0);
  }

  /** `\cell` / `\nestcell`: close the cell, folding in any completed deeper table. */
  endCell(depth: number, style: BlockStyle | undefined, inlines: Inline[]): void {
    this.pushCellParagraph(depth, style, inlines);
    this.flushCellRun(depth);
    this.flushIntoCell(depth + 1, depth);
    const blocks = this.cellBlockAt(depth);
    this.cellBlocks[depth - 1] = [];
    const t = this.tableAt(depth);
    const declared = t.rowProps[t.propCursor];
    const prop = declared !== undefined ? copyProp(declared) : emptyCellProp();
    t.propCursor += 1;
    t.row.cells.push([blocks, prop]);
  }

  /** `\row` / `\nestrow`: close the row (its last cell must already be closed). */
  endRow(depth: number): void {
    const t = this.tableAt(depth);
    const row = t.row;
    t.row = emptyRow();
    row.header = t.rowHeader;
    t.propCursor = 0;
    if (row.cells.length > 0) t.rows.push(row);
  }

  /** Take the finished table at `depth` as a block, if it has any rows. */
  takeTable(depth: number): Block | undefined {
    if (this.tables.length < depth || this.tables[depth - 1]!.rows.length === 0) {
      return undefined;
    }
    const t = this.tables[depth - 1]!;
    this.tables[depth - 1] = emptyTableBuild();
    const rows: GridRow[] = t.rows.map((r) => ({ cells: r.cells, header: r.header }));
    return buildEdgeTable(rows);
  }

  /** Build a finished table at `depth` into cell blocks one level up. */
  private flushIntoCell(depth: number, into: number): void {
    const block = this.takeTable(depth);
    if (block !== undefined) {
      this.flushCellRun(into);
      this.cellBlockAt(into).push(block);
    }
  }

  /** Collapse any dangling nested tables outward into their parent cells. */
  collapseNested(): void {
    for (let depth = this.tables.length; depth >= 2; depth -= 1) {
      this.flushIntoCell(depth, depth - 1);
    }
  }
}
