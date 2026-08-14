/** Ruled-grid table detection from stroked lines and thin `re` cell borders. */

export interface TableTextItem {
  text: string;
  x: number;
  y: number;
  width: number;
  page: number;
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
  markdown: string;
  itemIndices: number[];
}

const SNAP = 2.5;
const THIN = 3;
const MIN_RULE = 24;

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
    const table = detectPageTable(
      items,
      lines.filter((l) => l.page === page),
      rects.filter((r) => r.page === page),
      page,
    );
    if (table) out.push(table);
  }
  return out;
}

function detectPageTable(
  items: TableTextItem[],
  lines: TableLine[],
  rects: TableRect[],
  page: number,
): DetectedTable | undefined {
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
    } else if (r.width >= 80 && r.height >= 40) {
      // Large frames only — small decorative rects invent extra grid edges.
      horiz.push({ y: r.y, x1: r.x, x2: r.x + r.width });
      horiz.push({ y: r.y + r.height, x1: r.x, x2: r.x + r.width });
      vert.push({ x: r.x, y1: r.y, y2: r.y + r.height });
      vert.push({ x: r.x + r.width, y1: r.y, y2: r.y + r.height });
    }
  }

  const mergedH = mergeCollinearH(horiz);
  const mergedV = mergeCollinearV(vert);
  if (mergedH.length < 2 || mergedV.length < 2) return undefined;

  const xs = snapValues(
    mergedV.map((v) => v.x),
    SNAP,
  );
  const ys = snapValues(
    mergedH.map((h) => h.y),
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
      return bucket
        .map((b) => b.item.text.trim())
        .filter((t) => t.length > 0)
        .join(' ');
    }),
  );

  const pruned = pruneEmpty(cells, used, cellItems);
  if (!pruned) return undefined;
  const { cells: grid } = pruned;
  if (grid.length < 2 || grid[0]!.length < 2) return undefined;

  const filled = grid.flat().filter((c) => c.length > 0);
  const fillRate = filled.length / (grid.length * grid[0]!.length);
  if (fillRate < 0.15) return undefined;
  const multi = grid.filter((row) => row.filter((c) => c.length > 0).length >= 2).length;
  if (multi * 2 < grid.length) return undefined;

  const lengths = filled.map((c) => [...c].length);
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  if (avg > 80) return undefined;
  const long = lengths.filter((n) => n > 160).length;
  if (long > 0 && long / lengths.length > 0.2) return undefined;

  const markdown = tableToMarkdown(grid);
  if (markdown.trim().length === 0) return undefined;
  return { page, x: xLeft, y: yTop, markdown, itemIndices: unique(used) };
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

  // Drop item indices that lived only in pruned empty bands.
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
