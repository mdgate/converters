/** ODF tables: canonical grid construction with covered-cell consumption. */

import { type Element, ns } from '@mdgate/containers';
import {
  type Block,
  cellSpanning,
  GridBuilder,
  heading,
  inlinesAreEmpty,
  plain,
  resolveHeaderRows,
} from '@mdgate/document';
import { debug } from '@mdgate/utils';
import { parseDecimalU64 } from './styles.js';
import { type Ctx, parseContainer } from './text.js';

export function parseTable(elem: Element, ctx: Ctx): Block[] {
  const state: TableState = {
    builder: new GridBuilder(),
    pendingRows: 0,
    headerRows: 0,
    rowsEmitted: 0,
  };
  walkRows(elem, ctx, state, true);
  const table = state.builder.finish('data');
  if (table.grid.length === 0) return [];
  table.headerRows = resolveHeaderRows(table, state.headerRows);
  return [{ type: 'table', table }];
}

interface TableState {
  builder: GridBuilder;
  pendingRows: number;
  headerRows: number;
  rowsEmitted: number;
}

type RowCell =
  | { kind: 'covered'; repeat: number }
  | {
      kind: 'cell';
      repeat: number;
      colSpan: number;
      rowSpan: number;
      blocks: Block[];
    };

function emitTimes(repeat: number): number {
  return repeat > 10_000 ? 1 : repeat;
}

function walkRows(container: Element, ctx: Ctx, state: TableState, top: boolean): void {
  for (const child of container.childElems()) {
    if (child.ns !== ns.TABLE) continue;
    switch (child.local) {
      case 'table-header-rows': {
        const before = state.rowsEmitted;
        walkRows(child, ctx, state, false);
        if (top && state.headerRows === 0) {
          state.headerRows = state.rowsEmitted - before;
        }
        break;
      }
      case 'table-rows':
      case 'table-row-group':
        walkRows(child, ctx, state, false);
        break;
      case 'table-row': {
        const repeat = parseRepeat(child.attr(ns.TABLE, 'number-rows-repeated'));
        emitRow(child, ctx, state, repeat);
        break;
      }
      default:
        break;
    }
  }
}

function emitRow(row: Element, ctx: Ctx, state: TableState, repeat: number): void {
  if (rowIsEmpty(row)) {
    state.pendingRows = saturatingAdd(state.pendingRows, repeat);
    return;
  }
  if (state.pendingRows > 0) {
    if (state.pendingRows <= 10_000) {
      state.builder.nextRows(state.pendingRows);
      state.rowsEmitted += state.pendingRows;
    }
    state.pendingRows = 0;
  }
  const cells = parseRowCells(row, ctx);
  const times = emitTimes(repeat);
  for (let i = 0; i < times; i += 1) {
    state.builder.nextRow();
    state.rowsEmitted += 1;
    emitParsedCells(cells, state);
  }
}

function parseRowCells(row: Element, ctx: Ctx): RowCell[] {
  const out: RowCell[] = [];
  for (const cell of row.childElems()) {
    const repeat = parseRepeat(cell.attr(ns.TABLE, 'number-columns-repeated'));
    if (cell.is(ns.TABLE, 'covered-table-cell')) {
      out.push({ kind: 'covered', repeat });
      continue;
    }
    if (!cell.is(ns.TABLE, 'table-cell')) continue;
    const colSpan = parseSpan(cell.attr(ns.TABLE, 'number-columns-spanned'));
    const rowSpan = parseSpan(cell.attr(ns.TABLE, 'number-rows-spanned'));
    const blocks = cellBlocks(cell, ctx);
    out.push({ kind: 'cell', repeat, colSpan, rowSpan, blocks });
  }
  return out;
}

function emitParsedCells(cells: readonly RowCell[], state: TableState): void {
  let pendingCells = 0;
  for (const cell of cells) {
    if (cell.kind === 'covered') {
      flushGap(state, pendingCells);
      pendingCells = 0;
      const times = emitTimes(cell.repeat);
      for (let i = 0; i < times; i += 1) {
        if (!state.builder.covered()) {
          debug('covered table cell without a spanning origin');
        }
      }
    } else {
      if (cell.blocks.length === 0 && cell.colSpan === 1 && cell.rowSpan === 1) {
        pendingCells = saturatingAdd(pendingCells, cell.repeat);
        continue;
      }
      flushGap(state, pendingCells);
      pendingCells = 0;
      const times = emitTimes(cell.repeat);
      for (let i = 0; i < times; i += 1) {
        const blocks = times === 1 ? cell.blocks : cloneBlocks(cell.blocks);
        state.builder.place(cellSpanning(blocks, cell.colSpan, cell.rowSpan));
      }
    }
  }
}

function flushGap(state: TableState, pending: number): void {
  if (pending === 0 || pending > 10_000) return;
  state.builder.placeEmptyRun(pending);
}

function cellBlocks(cell: Element, ctx: Ctx): Block[] {
  const blocks = parseContainer(cell, ctx);
  const hasContent = blocks.some((b) =>
    b.type === 'paragraph' ? !inlinesAreEmpty(b.inlines) : true,
  );
  if (hasContent) return blocks;
  const text = valueText(cell);
  if (text !== undefined) {
    return [{ type: 'paragraph', inlines: [plain(text)] }];
  }
  return [];
}

function valueText(cell: Element): string | undefined {
  const valueType = cell.attr(ns.OFFICE, 'value-type');
  if (valueType === undefined) return undefined;
  switch (valueType) {
    case 'percentage': {
      const raw = cell.attr(ns.OFFICE, 'value');
      if (raw === undefined) return undefined;
      const v = parseF64(raw);
      if (v === undefined) return undefined;
      return `${trimFloat(v * 100)}%`;
    }
    case 'currency': {
      const raw = cell.attr(ns.OFFICE, 'value');
      if (raw === undefined) return undefined;
      const v = parseF64(raw);
      if (v === undefined) return undefined;
      const cur = cell.attr(ns.OFFICE, 'currency') ?? '';
      return cur.length === 0 ? trimFloat(v) : `${trimFloat(v)} ${cur}`;
    }
    case 'float': {
      const raw = cell.attr(ns.OFFICE, 'value');
      if (raw === undefined) return undefined;
      const v = parseF64(raw);
      if (v === undefined) return undefined;
      return trimFloat(v);
    }
    case 'date':
      return cell.attr(ns.OFFICE, 'date-value');
    case 'time': {
      const raw = cell.attr(ns.OFFICE, 'time-value');
      return raw !== undefined ? durationText(raw) : undefined;
    }
    case 'boolean': {
      const b = cell.attr(ns.OFFICE, 'boolean-value');
      if (b === undefined) return undefined;
      return b === 'true' ? 'TRUE' : 'FALSE';
    }
    case 'string':
      return cell.attr(ns.OFFICE, 'string-value');
    default:
      return undefined;
  }
}

/** Shortest round-trip float formatting — no fixed-precision rounding. */
function trimFloat(v: number): string {
  if (Number.isNaN(v)) return 'NaN';
  if (v === Number.POSITIVE_INFINITY) return 'inf';
  if (v === Number.NEGATIVE_INFINITY) return '-inf';
  return formatPlainNumber(v);
}

/**
 * Full ISO 8601 duration → clock text: `P1DT2H` → `26:00:00`,
 * `PT26H30M15S` → `26:30:15`. Year/month and unrepresentable values keep
 * their raw ISO text.
 */
export function durationText(iso: string): string {
  let total = 0;
  let number = '';
  let inTime = false;
  let negative = false;
  for (const c of iso) {
    if (c === '-' && total === 0 && number.length === 0) {
      negative = true;
    } else if (c === 'P') {
      // period marker
    } else if (c === 'T') {
      inTime = true;
      number = '';
    } else if ((c === 'Y' || c === 'M') && !inTime) {
      const n = parseF64(number);
      if (n !== undefined && n !== 0) return iso;
      number = '';
    } else if ((c === 'W' || c === 'D') && !inTime) {
      const unit = c === 'W' ? 604_800 : 86_400;
      total += (parseF64(number) ?? 0) * unit;
      number = '';
    } else if ((c === 'H' || c === 'M' || c === 'S') && inTime) {
      const unit = c === 'H' ? 3600 : c === 'M' ? 60 : 1;
      total += (parseF64(number) ?? 0) * unit;
      number = '';
    } else if ((c >= '0' && c <= '9') || c === '.') {
      number += c;
    } else {
      number = '';
    }
  }
  const totalMs = Math.round(total * 1000);
  if (!(totalMs >= 0 && totalMs < 1e18)) return iso;
  const sign = negative ? '-' : '';
  const hours = Math.floor(totalMs / 3_600_000);
  const rest = totalMs % 3_600_000;
  const minutes = Math.floor(rest / 60_000);
  const ms = rest % 60_000;
  if (ms % 1000 !== 0) {
    const sec = (ms / 1000).toFixed(3).padStart(6, '0');
    return `${sign}${hours}:${pad2(minutes)}:${sec}`;
  }
  return `${sign}${hours}:${pad2(minutes)}:${pad2(Math.floor(ms / 1000))}`;
}

function rowIsEmpty(row: Element): boolean {
  return row.childElems().every((cell) => {
    if (cell.is(ns.TABLE, 'covered-table-cell')) return false;
    if (!cell.is(ns.TABLE, 'table-cell')) return true;
    return (
      cell.attr(ns.TABLE, 'number-columns-spanned') === undefined &&
      cell.attr(ns.TABLE, 'number-rows-spanned') === undefined &&
      cell.attr(ns.OFFICE, 'value-type') === undefined &&
      cell.children.length === 0
    );
  });
}

/** One sheet of a spreadsheet body. */
export function parseSpreadsheet(sheet: Element, ctx: Ctx): Block[] {
  const tables = sheet.childElems().filter((e) => e.is(ns.TABLE, 'table'));
  const multiSheet = tables.length > 1;
  const blocks: Block[] = [];
  for (const table of tables) {
    const name = table.attr(ns.TABLE, 'name') ?? '';
    const content = parseTable(table, ctx);
    if (content.length === 0) continue;
    if (multiSheet) {
      blocks.push(heading(2, [plain(name)]));
    }
    blocks.push(...content);
  }
  return blocks;
}

function parseRepeat(v: string | undefined): number {
  if (v === undefined) return 1;
  const n = parseDecimalU64(v);
  if (n === undefined) return 1;
  return Math.max(n, 1);
}

function parseSpan(v: string | undefined): number {
  if (v === undefined) return 1;
  if (!/^[0-9]+$/.test(v)) return 1;
  let n: bigint;
  try {
    n = BigInt(v);
  } catch {
    return 1;
  }
  if (n > 0xffff_ffffn) return 1;
  if (n < 1n) return 1;
  return Number(n);
}

function parseF64(s: string): number | undefined {
  const lower = s.toLowerCase();
  if (lower === 'inf' || lower === 'infinity' || lower === '+inf' || lower === '+infinity') {
    return Number.POSITIVE_INFINITY;
  }
  if (lower === '-inf' || lower === '-infinity') return Number.NEGATIVE_INFINITY;
  if (lower === 'nan' || lower === '+nan' || lower === '-nan') return Number.NaN;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Shortest JS number string; keeps distinct -0. */
function formatPlainNumber(v: number): string {
  if (Object.is(v, -0)) return '-0';
  return String(v);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function cloneBlocks(blocks: Block[]): Block[] {
  return structuredClone(blocks);
}

function saturatingAdd(a: number, b: number): number {
  const s = a + b;
  if (!Number.isFinite(s) || s > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER;
  return s;
}
