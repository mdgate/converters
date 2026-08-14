import { type CellSlot, inlinesToPlainText, type Table } from '../model/index.js';
import { trim } from '../unicode.js';

const SAMPLE_ROWS = 50;
const DOMINANCE_NUM = 9;
const DOMINANCE_DEN = 10;
const MAX_LABEL = 64;

type Kind = 'number' | 'bool' | 'date' | 'text';

/**
 * A grid's header row count: what the format declared, or — when it declared
 * none — 1 if the first row labels the columns and 0 otherwise.
 */
export function resolveHeaderRows(table: Table, declared: number): number {
  if (declared > 0) return Math.min(declared, table.grid.length);
  const grid = table.grid;
  if (grid.length < 2) return 0;
  if (
    grid[0]!.some((s) => !(s.type === 'origin' && s.cell.colSpan === 1 && s.cell.rowSpan === 1))
  ) {
    return 0;
  }
  const sample = grid.slice(1, Math.min(grid.length, SAMPLE_ROWS + 1));
  if (grid[0]!.length !== modalWidth(sample)) return 0;

  const head = grid[0]!.map(slotText);
  const body = sample.map((row) => row.map(slotText));
  const contentWidth = (row: string[]): number => {
    for (let i = row.length - 1; i >= 0; i -= 1) {
      if (trim(row[i]!).length > 0) return i + 1;
    }
    return 0;
  };
  let width = contentWidth(head);
  for (const row of body) {
    const w = contentWidth(row);
    if (w > width) width = w;
  }
  if (width === 0 || width > head.length) return 0;

  const seen = new Set<string>();
  for (let c = 0; c < width; c += 1) {
    const value = head[c]!;
    if (trim(value).length === 0) {
      if (c === 0) continue;
      return 0;
    }
    if (value.includes('\n')) return 0;
    const folded = fold(value);
    if (seen.has(folded)) return 0;
    seen.add(folded);
  }

  let headerVotes = 0;
  let dataVotes = 0;
  for (let c = 0; c < width; c += 1) {
    const label = head[c]!;
    const values: string[] = [];
    for (const row of body) {
      const v = row[c];
      if (v === undefined) continue;
      const t = trim(v);
      if (t.length > 0) values.push(t);
    }
    if (values.length === 0) continue;
    const labelTrim = trim(label);
    const kind = dominantKind(values);
    if (kind !== undefined && kind !== 'text') {
      if (classify(labelTrim) === 'text') headerVotes += 1;
      else dataVotes += 1;
    } else if (values.some((v) => fold(v) === fold(labelTrim))) {
      dataVotes += 1;
    }
  }

  if (headerVotes === 0 && dataVotes === 0) {
    const labelled = head.slice(0, width).every((v) => [...v].length <= MAX_LABEL);
    return labelled ? 1 : 0;
  }
  return headerVotes > dataVotes ? 1 : 0;
}

function modalWidth(rows: CellSlot[][]): number {
  const tally = new Map<number, number>();
  for (const row of rows) {
    tally.set(row.length, (tally.get(row.length) ?? 0) + 1);
  }
  let bestW = 0;
  let bestN = -1;
  for (const [width, n] of tally) {
    if (n > bestN || (n === bestN && width > bestW)) {
      bestN = n;
      bestW = width;
    }
  }
  return bestW;
}

function slotText(slot: CellSlot): string {
  if (slot.type !== 'origin') return '';
  let out = '';
  for (const block of slot.cell.blocks) {
    if (block.type !== 'paragraph') return '';
    if (out.length > 0) out += '\n';
    out += inlinesToPlainText(block.inlines);
  }
  return out;
}

function fold(value: string): string {
  return trim(value).toLowerCase();
}

function dominantKind(values: string[]): Kind | undefined {
  const kinds: Kind[] = ['number', 'bool', 'date', 'text'];
  for (const kind of kinds) {
    let n = 0;
    for (const v of values) {
      if (classify(v) === kind) n += 1;
    }
    if (n * DOMINANCE_DEN >= values.length * DOMINANCE_NUM) return kind;
  }
  return undefined;
}

function classify(value: string): Kind | undefined {
  const v = trim(value);
  if (v.length === 0) return undefined;
  if (isNumber(v)) return 'number';
  const f = fold(v);
  if (f === 'true' || f === 'false' || f === 'yes' || f === 'no') return 'bool';
  if (isTemporal(v)) return 'date';
  return 'text';
}

function isNumber(value: string): boolean {
  const stripped = value.endsWith('%') ? value.slice(0, -1) : value;
  let cleaned = '';
  for (const c of stripped) {
    if (c !== ',' && c !== ' ' && c !== '_' && c !== '\u00a0') cleaned += c;
  }
  if (![...cleaned].some((c) => c >= '0' && c <= '9')) return false;
  return parseRustF64(cleaned) !== undefined;
}

/** Strict `f64` parse: the whole string must be a number; `inf`/`NaN` allowed by rust. */
function parseRustF64(s: string): number | undefined {
  if (s.length === 0) return undefined;
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

function isTemporal(value: string): boolean {
  let date = value;
  let time = '';
  const tPos = indexOfAny(value, ['T', ' ']);
  if (tPos >= 0) {
    date = value.slice(0, tPos);
    time = value.slice(tPos + 1);
  }
  if (time.endsWith('Z')) time = time.slice(0, -1);
  const dot = time.indexOf('.');
  if (dot >= 0) time = time.slice(0, dot);
  const isClock = (t: string): boolean => {
    const n = digitGroups(t, [':']);
    return n === 2 || n === 3;
  };
  if (digitGroups(date, ['-', '/', '.']) === 3) {
    return time.length === 0 || isClock(time);
  }
  return time.length === 0 && isClock(date);
}

function digitGroups(value: string, seps: string[]): number {
  const sep = seps.find((s) => value.includes(s));
  if (sep === undefined) return 0;
  const parts = value.split(sep);
  for (const p of parts) {
    if (p.length < 1 || p.length > 4) return 0;
    for (let i = 0; i < p.length; i += 1) {
      const c = p.charCodeAt(i);
      if (c < 48 || c > 57) return 0;
    }
  }
  return parts.length;
}

function indexOfAny(s: string, chars: string[]): number {
  let best = -1;
  for (const c of chars) {
    const i = s.indexOf(c);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}
