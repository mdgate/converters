/** Ruled-grid and borderless table detection from lines, thin `re` borders, and aligned text. */

export interface TableTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  page: number;
  fontSize?: number;
}

export interface TableLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  page: number;
}

export interface TableRect {
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
}

export interface DetectedTable {
  page: number;
  x: number;
  y: number;
  x2: number;
  y2: number;
  markdown: string;
  itemIndices: number[];
}

const SNAP = 2.5;
const THIN = 3;
const MIN_RULE = 24;
const COL_GAP_FACTOR = 1.0;
const MIN_COLUMNS = 2;
const MIN_ROWS = 2;
const MAX_TABLE_ROWS = 40;
const MAX_CELL_WORDS = 6;
const MAX_KEY_VALUE_WORDS = 40;
const MAX_TABLE_WORDS = 400;
const PROSE_AVG_CELL_CHARS = 18;
const PAGE_COVER = 0.7;

export function detectTables(
  items: TableTextItem[],
  lines: TableLine[],
  rects: TableRect[],
): DetectedTable[] {
  const pages = new Set<number>();
  for (const it of items) pages.add(it.page);
  for (const ln of lines) pages.add(ln.page);
  for (const r of rects) pages.add(r.page);

  const out: DetectedTable[] = [];
  for (const page of [...pages].sort((a, b) => a - b)) {
    const ruled = detectRuledTables(
      items,
      lines.filter((l) => l.page === page),
      rects.filter((r) => r.page === page),
      page,
    );
    const claimed = new Set<number>();
    for (const t of ruled) {
      for (const idx of t.itemIndices) claimed.add(idx);
    }
    const borderless = detectBorderlessTables(items, page, claimed);
    out.push(...ruled, ...borderless);
  }
  return out;
}

function detectRuledTables(
  items: TableTextItem[],
  lines: TableLine[],
  rects: TableRect[],
  page: number,
): DetectedTable[] {
  const horiz: { y: number; x1: number; x2: number }[] = [];
  const vert: { x: number; y1: number; y2: number }[] = [];

  for (const ln of lines) {
    if (Math.abs(ln.y1 - ln.y2) <= SNAP && Math.abs(ln.x2 - ln.x1) >= MIN_RULE) {
      horiz.push({
        y: (ln.y1 + ln.y2) / 2,
        x1: Math.min(ln.x1, ln.x2),
        x2: Math.max(ln.x1, ln.x2),
      });
    } else if (Math.abs(ln.x1 - ln.x2) <= SNAP && Math.abs(ln.y2 - ln.y1) >= MIN_RULE) {
      vert.push({ x: (ln.x1 + ln.x2) / 2, y1: Math.min(ln.y1, ln.y2), y2: Math.max(ln.y1, ln.y2) });
    }
  }

  for (const r of rects) {
    if (r.width < 0.2 || r.height < 0.2) continue;
    if (r.height <= THIN && r.width >= MIN_RULE) {
      horiz.push({ y: r.y + r.height / 2, x1: r.x, x2: r.x + r.width });
    } else if (r.width <= THIN && r.height >= MIN_RULE) {
      vert.push({ x: r.x + r.width / 2, y1: r.y, y2: r.y + r.height });
    }
  }

  const mergedH = mergeCollinearH(horiz);
  const mergedV = mergeCollinearV(vert);
  if (mergedH.length < 2 || mergedV.length < 2) return [];

  const groups = connectedRuleGroups(mergedH, mergedV);
  const out: DetectedTable[] = [];
  const claimed = new Set<number>();
  for (const g of groups) {
    const table = buildGridTable(items, g.h, g.v, page, claimed);
    if (table) {
      out.push(table);
      for (const idx of table.itemIndices) claimed.add(idx);
    }
  }
  return out;
}

function connectedRuleGroups(
  horiz: { y: number; x1: number; x2: number }[],
  vert: { x: number; y1: number; y2: number }[],
): { h: typeof horiz; v: typeof vert }[] {
  const nH = horiz.length;
  const nV = vert.length;
  const n = nH + nV;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (a: number): number => {
    let x = a;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const unite = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  for (let i = 0; i < nH; i += 1) {
    const h = horiz[i]!;
    for (let j = 0; j < nV; j += 1) {
      const v = vert[j]!;
      if (v.x >= h.x1 - SNAP && v.x <= h.x2 + SNAP && h.y >= v.y1 - SNAP && h.y <= v.y2 + SNAP) {
        unite(i, nH + j);
      }
    }
  }

  const buckets = new Map<number, { h: number[]; v: number[] }>();
  for (let i = 0; i < nH; i += 1) {
    const r = find(i);
    const b = buckets.get(r) ?? { h: [], v: [] };
    b.h.push(i);
    buckets.set(r, b);
  }
  for (let j = 0; j < nV; j += 1) {
    const r = find(nH + j);
    const b = buckets.get(r) ?? { h: [], v: [] };
    b.v.push(j);
    buckets.set(r, b);
  }

  const groups: { h: typeof horiz; v: typeof vert }[] = [];
  for (const b of buckets.values()) {
    if (b.h.length < 2 || b.v.length < 2) continue;
    groups.push({
      h: b.h.map((i) => horiz[i]!),
      v: b.v.map((j) => vert[j]!),
    });
  }
  groups.sort((a, c) => Math.max(...c.h.map((x) => x.y)) - Math.max(...a.h.map((x) => x.y)));
  return groups;
}

function buildGridTable(
  items: TableTextItem[],
  horiz: { y: number; x1: number; x2: number }[],
  vert: { x: number; y1: number; y2: number }[],
  page: number,
  claimed: Set<number>,
): DetectedTable | undefined {
  const xs = snapValues(
    vert.map((v) => v.x),
    SNAP,
  );
  const ys = snapValues(
    horiz.map((h) => h.y),
    SNAP,
  ).sort((a, b) => b - a);
  if (xs.length < 3 || ys.length < 3) return undefined;

  const colEdges = xs;
  const rowEdges = ys;
  const nCols = colEdges.length - 1;
  const nRows = rowEdges.length - 1;
  if (nCols < 2 || nRows < 2 || nCols > 20 || nRows > 60) return undefined;

  const cellItems: { idx: number; item: TableTextItem }[][][] = Array.from({ length: nRows }, () =>
    Array.from({ length: nCols }, () => []),
  );
  const used: number[] = [];
  const xLeft = colEdges[0]!;
  const xRight = colEdges[colEdges.length - 1]!;
  const yTop = rowEdges[0]!;
  const yBottom = rowEdges[rowEdges.length - 1]!;

  for (let idx = 0; idx < items.length; idx += 1) {
    if (claimed.has(idx)) continue;
    const item = items[idx]!;
    if (item.page !== page || item.text.trim().length === 0) continue;
    const cx = item.x + Math.max(item.width, 0) / 2;
    const cy = item.y;
    if (cx < xLeft - 4 || cx > xRight + 4 || cy < yBottom - 4 || cy > yTop + 4) continue;
    const col = findBand(colEdges, cx, false);
    const row = findBand(rowEdges, cy, true);
    if (col === undefined || row === undefined) continue;
    cellItems[row]![col]!.push({ idx, item });
    used.push(idx);
  }

  if (used.length < 4) return undefined;

  const cells = cellItems.map((row) =>
    row.map((bucket) => {
      bucket.sort((a, b) => b.item.y - a.item.y || a.item.x - b.item.x);
      return joinCellText(bucket.map((b) => b.item));
    }),
  );

  const pruned = pruneEmpty(cells, used, cellItems);
  if (!pruned) return undefined;
  const { cells: grid } = pruned;
  if (grid.length < 2 || grid[0]!.length < 2) return undefined;
  if (!acceptGrid(grid)) return undefined;

  const markdown = tableToMarkdown(grid);
  if (markdown.trim().length === 0) return undefined;
  return {
    page,
    x: xLeft,
    y: yTop,
    x2: xRight,
    y2: yBottom,
    markdown,
    itemIndices: unique(used),
  };
}

function acceptGrid(grid: string[][]): boolean {
  const filled = grid.flat().filter((c) => c.length > 0);
  const fillRate = filled.length / (grid.length * grid[0]!.length);
  if (fillRate < 0.15) return false;
  const multi = grid.filter((row) => row.filter((c) => c.length > 0).length >= 2).length;
  if (multi * 2 < grid.length) return false;
  const lengths = filled.map((c) => [...c].length);
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  if (avg > 80) return false;
  const long = lengths.filter((n) => n > 160).length;
  if (long > 0 && long / lengths.length > 0.2) return false;
  return true;
}

interface CellSeg {
  x: number;
  x2: number;
  y: number;
  text: string;
  indices: number[];
  words: number;
}

interface RowCand {
  y: number;
  segs: CellSeg[];
}

function detectBorderlessTables(
  items: TableTextItem[],
  page: number,
  claimed: Set<number>,
): DetectedTable[] {
  const rows = collectAlignedRows(items, page, claimed);
  if (rows.length < MIN_ROWS) return [];

  const pageBox = itemBounds(
    items.filter((it, i) => it.page === page && !claimed.has(i) && it.text.trim().length > 0),
  );
  const out: DetectedTable[] = [];
  let i = 0;
  while (i < rows.length) {
    if (!isTableRow(rows[i]!)) {
      i += 1;
      continue;
    }
    const run = [rows[i]!];
    let j = i + 1;
    while (j < rows.length) {
      const prev = run[run.length - 1]!;
      const cur = rows[j]!;
      const gap = prev.y - cur.y;
      const fs = 12;
      if (gap > fs * 3.2) break;
      if (!isTableRow(cur)) break;
      run.push(cur);
      j += 1;
    }
    if (run.length >= MIN_ROWS) {
      const table = buildAlignedTable(run, page, pageBox);
      if (table) out.push(table);
    }
    i = Math.max(j, i + 1);
  }
  return out;
}

function collectAlignedRows(items: TableTextItem[], page: number, claimed: Set<number>): RowCand[] {
  const pts: { idx: number; item: TableTextItem }[] = [];
  for (let idx = 0; idx < items.length; idx += 1) {
    if (claimed.has(idx)) continue;
    const item = items[idx]!;
    if (item.page !== page || item.text.trim().length === 0) continue;
    pts.push({ idx, item });
  }
  pts.sort((a, b) => b.item.y - a.item.y || a.item.x - b.item.x);

  const rows: { idx: number; item: TableTextItem }[][] = [];
  for (const pt of pts) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0]!.item.y - pt.item.y) < 3.5) last.push(pt);
    else rows.push([pt]);
  }

  const out: RowCand[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.item.x - b.item.x);
    const segs = splitSegments(row);
    if (segs.length === 0) continue;
    out.push({ y: row[0]!.item.y, segs });
  }
  return out;
}

function splitSegments(row: { idx: number; item: TableTextItem }[]): CellSeg[] {
  if (row.length === 0) return [];
  const segs: { idx: number; item: TableTextItem }[][] = [[row[0]!]];
  for (let i = 1; i < row.length; i += 1) {
    const prev = segs[segs.length - 1]![segs[segs.length - 1]!.length - 1]!.item;
    const curr = row[i]!;
    const gap = curr.item.x - (prev.x + Math.max(prev.width, 0));
    const thresh = Math.max(10, 8 * COL_GAP_FACTOR);
    if (gap > thresh) segs.push([curr]);
    else segs[segs.length - 1]!.push(curr);
  }
  return segs.map((g) => {
    const first = g[0]!.item;
    const last = g[g.length - 1]!.item;
    const text = joinCellText(g.map((c) => c.item));
    return {
      x: first.x,
      x2: last.x + Math.max(last.width, 0),
      y: first.y,
      text,
      indices: g.map((c) => c.idx),
      words: wordCount(text),
    };
  });
}

function joinCellText(items: TableTextItem[]): string {
  let out = '';
  let prev: TableTextItem | undefined;
  for (const item of items) {
    const t = item.text.trim();
    if (t.length === 0) continue;
    if (prev && cellNeedsSpace(prev, item, out)) out += ' ';
    out += t;
    prev = item;
  }
  return out;
}

function cellNeedsSpace(prev: TableTextItem, curr: TableTextItem, out: string): boolean {
  if (out.endsWith(' ') || curr.text.startsWith(' ') || prev.text.endsWith(' ')) return true;
  if (out.endsWith('-') || curr.text.startsWith('-') || curr.text.trim() === '-') return false;
  const currFirst = [...curr.text.trimStart()][0];
  if (currFirst !== undefined && ".,;!?)]}'".includes(currFirst)) return false;
  const gap = curr.x - (prev.x + Math.max(prev.width, 0));
  const fs = Math.max(prev.fontSize ?? 12, curr.fontSize ?? 12, 8);
  if (gap > fs * 3 || gap < -fs) return true;
  if (gap < fs * 0.12) return false;
  return true;
}

function isTableRow(row: RowCand): boolean {
  if (row.segs.length < MIN_COLUMNS) return false;
  if (row.segs.some((s) => s.words > MAX_KEY_VALUE_WORDS)) return false;
  const long = row.segs.filter((s) => s.words > MAX_CELL_WORDS).length;
  if (row.segs.length === 2) {
    if (row.segs[0]!.words > MAX_CELL_WORDS && row.segs[1]!.words > MAX_CELL_WORDS) return false;
    const avgChars =
      row.segs.reduce((n, s) => n + [...s.text].length, 0) / Math.max(row.segs.length, 1);
    if (avgChars > 55) return false;
  } else if (long > 1) {
    return false;
  }
  return true;
}

function buildAlignedTable(
  run: RowCand[],
  page: number,
  pageBox: { x: number; y: number; x2: number; y2: number } | undefined,
): DetectedTable | undefined {
  if (run.length < MIN_ROWS || run.length > MAX_TABLE_ROWS) return undefined;
  const counts = run.map((r) => r.segs.length);
  const maxCols = Math.max(...counts);
  const nCols = maxCols >= 3 ? maxCols : medianInt(counts);
  if (nCols < MIN_COLUMNS) return undefined;
  const matching = counts.filter((c) => c === nCols).length;
  if (nCols >= 3) {
    if (matching < 1) return undefined;
  } else if (matching / run.length < 0.5) {
    return undefined;
  }

  const header = run.find((r) => r.segs.length === nCols) ?? run[0]!;
  const colXs = header.segs.map((s) => (s.x + s.x2) / 2);

  const grid: string[][] = [];
  const used: number[] = [];
  for (const row of run) {
    const cells = Array.from({ length: nCols }, () => '');
    for (const seg of row.segs) {
      const col = nearestCol(colXs, (seg.x + seg.x2) / 2);
      const prev = cells[col]!;
      cells[col] = prev.length === 0 ? seg.text : `${prev} ${seg.text}`;
      used.push(...seg.indices);
    }
    grid.push(cells);
  }

  if (!acceptGrid(grid)) return undefined;
  if (looksLikePageColumns(run, grid)) return undefined;
  if (!acceptBorderless(grid, run, pageBox)) return undefined;

  const markdown = tableToMarkdown(grid);
  if (markdown.trim().length === 0) return undefined;
  const xs = run.flatMap((r) => r.segs.flatMap((s) => [s.x, s.x2]));
  const ys = run.map((r) => r.y);
  return {
    page,
    x: Math.min(...xs),
    y: Math.max(...ys) + 8,
    x2: Math.max(...xs),
    y2: Math.min(...ys) - 8,
    markdown,
    itemIndices: unique(used),
  };
}

function looksLikePageColumns(run: RowCand[], grid: string[][]): boolean {
  if (grid[0]!.length !== 2) return false;
  if (run.some((r) => r.segs.length >= 3)) return false;
  const leftRight = run.map((r) => {
    const left = r.segs[0]!;
    const right = r.segs[r.segs.length - 1]!;
    return { left, right };
  });
  const leftMax = Math.max(...leftRight.map((p) => p.left.x2));
  const rightMin = Math.min(...leftRight.map((p) => p.right.x));
  const gutter = rightMin - leftMax;
  const widths = run.flatMap((r) => r.segs.map((s) => Math.max(s.x2 - s.x, 1)));
  const medW = medianInt(widths.map((w) => Math.round(w)));
  if (gutter < Math.max(28, medW * 1.8)) return false;
  const col0 = grid.map((row) => row[0] ?? '');
  const col1 = grid.map((row) => row[1] ?? '');
  const avgChars = (col: string[]): number =>
    col.reduce((n, c) => n + [...c].length, 0) / Math.max(col.length, 1);
  const leftChars = avgChars(col0);
  const rightChars = avgChars(col1);
  if (Math.abs(leftChars - rightChars) > 14) return false;
  const numeric = grid.flat().filter((c) => /^-?\d[\d.,%]*$/.test(c.trim())).length;
  if (numeric >= grid.length * 0.4) return false;
  return true;
}

function acceptBorderless(
  grid: string[][],
  run: RowCand[],
  pageBox: { x: number; y: number; x2: number; y2: number } | undefined,
): boolean {
  const cells = grid.flat().filter((c) => c.length > 0);
  const words = cells.reduce((n, c) => n + wordCount(c), 0);
  if (words > MAX_TABLE_WORDS) return false;
  const avgChars = cells.reduce((n, c) => n + [...c].length, 0) / Math.max(cells.length, 1);
  const nCols = grid[0]!.length;
  if (nCols === 2 && avgChars > PROSE_AVG_CELL_CHARS) {
    const avgWords = words / Math.max(cells.length, 1);
    if (avgWords > 4) return false;
  }
  if (pageBox) {
    const x1 = Math.min(...run.flatMap((r) => r.segs.map((s) => s.x)));
    const x2 = Math.max(...run.flatMap((r) => r.segs.map((s) => s.x2)));
    const y1 = Math.max(...run.map((r) => r.y));
    const y2 = Math.min(...run.map((r) => r.y));
    const area = Math.max(x2 - x1, 1) * Math.max(y1 - y2, 1);
    const pageArea = Math.max(pageBox.x2 - pageBox.x, 1) * Math.max(pageBox.y - pageBox.y2, 1);
    if (area / pageArea > PAGE_COVER && avgChars > 20) return false;
  }
  return true;
}

function nearestCol(colXs: number[], x: number): number {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < colXs.length; i += 1) {
    const d = Math.abs(colXs[i]! - x);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function medianInt(values: number[]): number {
  if (values.length === 0) return 0;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

function itemBounds(
  items: TableTextItem[],
): { x: number; y: number; x2: number; y2: number } | undefined {
  if (items.length === 0) return undefined;
  let x = Number.POSITIVE_INFINITY;
  let y = Number.NEGATIVE_INFINITY;
  let x2 = Number.NEGATIVE_INFINITY;
  let y2 = Number.POSITIVE_INFINITY;
  for (const it of items) {
    x = Math.min(x, it.x);
    y = Math.max(y, it.y);
    x2 = Math.max(x2, it.x + Math.max(it.width, 0));
    y2 = Math.min(y2, it.y);
  }
  return { x, y, x2, y2 };
}

function findBand(edges: number[], value: number, descending: boolean): number | undefined {
  const n = edges.length - 1;
  for (let i = 0; i < n; i += 1) {
    if (descending) {
      const top = edges[i]!;
      const bot = edges[i + 1]!;
      if (value <= top + SNAP && value >= bot - SNAP) return i;
    } else {
      const left = edges[i]!;
      const right = edges[i + 1]!;
      if (value >= left - SNAP && value <= right + SNAP) return i;
    }
  }
  return undefined;
}

function mergeCollinearH(
  rules: { y: number; x1: number; x2: number }[],
): { y: number; x1: number; x2: number }[] {
  const sorted = rules.slice().sort((a, b) => b.y - a.y || a.x1 - b.x1);
  const groups: { y: number; x1: number; x2: number }[][] = [];
  for (const r of sorted) {
    const g = groups.find((gg) => Math.abs(gg[0]!.y - r.y) <= SNAP);
    if (g) g.push(r);
    else groups.push([r]);
  }
  const out: { y: number; x1: number; x2: number }[] = [];
  for (const g of groups) {
    g.sort((a, b) => a.x1 - b.x1);
    const y = g.reduce((s, r) => s + r.y, 0) / g.length;
    let cur = { y, x1: g[0]!.x1, x2: g[0]!.x2 };
    for (let i = 1; i < g.length; i += 1) {
      const r = g[i]!;
      if (r.x1 <= cur.x2 + 6) cur.x2 = Math.max(cur.x2, r.x2);
      else {
        out.push(cur);
        cur = { y, x1: r.x1, x2: r.x2 };
      }
    }
    out.push(cur);
  }
  return out;
}

function mergeCollinearV(
  rules: { x: number; y1: number; y2: number }[],
): { x: number; y1: number; y2: number }[] {
  const sorted = rules.slice().sort((a, b) => a.x - b.x || a.y1 - b.y1);
  const groups: { x: number; y1: number; y2: number }[][] = [];
  for (const r of sorted) {
    const g = groups.find((gg) => Math.abs(gg[0]!.x - r.x) <= SNAP);
    if (g) g.push(r);
    else groups.push([r]);
  }
  const out: { x: number; y1: number; y2: number }[] = [];
  for (const g of groups) {
    g.sort((a, b) => a.y1 - b.y1);
    const x = g.reduce((s, r) => s + r.x, 0) / g.length;
    let cur = { x, y1: g[0]!.y1, y2: g[0]!.y2 };
    for (let i = 1; i < g.length; i += 1) {
      const r = g[i]!;
      if (r.y1 <= cur.y2 + 6) cur.y2 = Math.max(cur.y2, r.y2);
      else {
        out.push(cur);
        cur = { x, y1: r.y1, y2: r.y2 };
      }
    }
    out.push(cur);
  }
  return out;
}

function snapValues(values: number[], tol: number): number[] {
  const sorted = values.slice().sort((a, b) => a - b);
  const out: number[] = [];
  let bucket: number[] = [];
  for (const v of sorted) {
    if (bucket.length === 0 || v - bucket[0]! <= tol) bucket.push(v);
    else {
      out.push(bucket.reduce((s, n) => s + n, 0) / bucket.length);
      bucket = [v];
    }
  }
  if (bucket.length > 0) out.push(bucket.reduce((s, n) => s + n, 0) / bucket.length);
  return out;
}

function pruneEmpty(
  cells: string[][],
  used: number[],
  cellItems: { idx: number; item: TableTextItem }[][][],
): { cells: string[][] } | undefined {
  const keepRow = cells.map((row) => row.some((c) => c.length > 0));
  const nCols = cells[0]?.length ?? 0;
  const keepCol = Array.from({ length: nCols }, (_, c) =>
    cells.some((row) => (row[c] ?? '').length > 0),
  );
  const next = cells.filter((_, r) => keepRow[r]).map((row) => row.filter((_, c) => keepCol[c]));
  if (next.length === 0 || (next[0]?.length ?? 0) === 0) return undefined;

  const keep = new Set<number>();
  for (let r = 0; r < cellItems.length; r += 1) {
    if (!keepRow[r]) continue;
    for (let c = 0; c < nCols; c += 1) {
      if (!keepCol[c]) continue;
      for (const b of cellItems[r]![c]!) keep.add(b.idx);
    }
  }
  used.length = 0;
  used.push(...keep);
  return { cells: next };
}

function tableToMarkdown(cells: string[][]): string {
  if (cells.length === 0 || cells[0]!.length === 0) return '';
  const cols = Math.max(...cells.map((r) => r.length));
  const rows = cells.map((r) => {
    const padded = r.slice();
    while (padded.length < cols) padded.push('');
    return padded;
  });
  const esc = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
  let out = '|';
  for (const cell of rows[0]!) out += `${esc(cell)}|`;
  out += '\n|';
  for (let i = 0; i < cols; i += 1) out += '---|';
  out += '\n';
  for (const row of rows.slice(1)) {
    out += '|';
    for (const cell of row) out += `${esc(cell)}|`;
    out += '\n';
  }
  return out;
}

function unique(ids: number[]): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}
