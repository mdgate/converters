/** XY-Cut++ reading order and column-aware line grouping. */

export interface LineItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  page: number;
  dx?: number;
  dy?: number;
}

export interface LayoutBox {
  x: number;
  y: number;
  x2: number;
  y2: number;
}

const MIN_GAP = 5;
const BBOX_SHRINK = 3;
const SPAN_RATIO = 0.7;
const SPANNING_WIDTH = 0.55;
const SPLIT_MARGIN = 6;
const BAND_TOLERANCE = 8;
const Y_BUCKET = 4;
const MIN_CENTER_GAP = 20;
const MIN_COL_WIDTH = 50;
const MERGE_TOL = 0.5;
const MAX_DEPTH = 16;
const GUTTER_HIT = 4;
const GUTTER_MIN_GAP = 8;
const NARROW_WIDTH_RATIO = 0.1;
const MARGIN_WIDTH = 1;
const COLUMN_OVERLAP = 0.2;

export function groupIntoLines<T extends LineItem>(items: T[]): T[][] {
  const upright: T[] = [];
  const rotated: T[] = [];
  for (const item of items) {
    if (isUpright(item)) upright.push(item);
    else rotated.push(item);
  }
  const lines = groupAxisAligned(upright);
  lines.push(...groupRotated(rotated));
  lines.sort((a, b) => a[0]!.page - b[0]!.page || b[0]!.y - a[0]!.y || a[0]!.x - b[0]!.x);
  return lines;
}

function isUpright(item: LineItem): boolean {
  const dx = item.dx ?? 1;
  const dy = item.dy ?? 0;
  return Math.abs(dy) <= Math.abs(dx) * 0.35;
}

function groupAxisAligned<T extends LineItem>(items: T[]): T[][] {
  const gutters = detectGutters(items);
  const sorted = items.slice().sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const rows: T[][] = [];
  for (const item of sorted) {
    const last = rows[rows.length - 1];
    const yTol = Math.max(3, item.fontSize * 0.25);
    if (last && last[0]!.page === item.page && Math.abs(last[0]!.y - item.y) < yTol) {
      last.push(item);
    } else {
      rows.push([item]);
    }
  }
  const lines: T[][] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    const pageGutters = gutters.get(row[0]!.page) ?? [];
    lines.push(...splitRowByGap(row, pageGutters));
  }
  return lines;
}

function splitRowByGap<T extends LineItem>(row: T[], gutters: number[]): T[][] {
  if (row.length === 0) return [];
  const segs: T[][] = [[row[0]!]];
  for (let i = 1; i < row.length; i += 1) {
    const prev = segs[segs.length - 1]![segs[segs.length - 1]!.length - 1]!;
    const curr = row[i]!;
    const prevRight = prev.x + Math.max(prev.width, 0);
    const gap = curr.x - prevRight;
    const fs = Math.max(prev.fontSize, curr.fontSize, 8);
    const atGutter = gutters.some((g) => prevRight <= g + GUTTER_HIT && curr.x >= g - GUTTER_HIT);
    const th = atGutter ? Math.max(fs * 0.45, GUTTER_MIN_GAP) : Math.max(fs * 1.2, 10);
    if (gap > th) segs.push([curr]);
    else segs[segs.length - 1]!.push(curr);
  }
  return segs;
}

function detectGutters<T extends LineItem>(items: T[]): Map<number, number[]> {
  const byPage = new Map<number, T[]>();
  for (const item of items) {
    const list = byPage.get(item.page) ?? [];
    list.push(item);
    byPage.set(item.page, list);
  }
  const out = new Map<number, number[]>();
  for (const [page, pageItems] of byPage) {
    const boxes = pageItems.filter((it) => it.width >= 1).map(itemBox);
    out.set(page, collectGutters(boxes, 0));
  }
  return out;
}

function itemBox(item: LineItem): LayoutBox {
  const h = Math.max(item.height, item.fontSize, 8);
  return {
    x: item.x,
    y: item.y + h * 0.8,
    x2: item.x + Math.max(item.width, 0),
    y2: item.y - h * 0.2,
  };
}

function collectGutters(boxes: LayoutBox[], depth: number): number[] {
  if (boxes.length < 4 || depth >= 4) return [];
  const gap = findVerticalGap(boxes);
  if (!gap) return [];
  const left = boxes.filter((b) => (b.x + b.x2) / 2 < gap.split);
  const right = boxes.filter((b) => (b.x + b.x2) / 2 >= gap.split);
  if (left.length < 2 || right.length < 2) return [];
  return [gap.split, ...collectGutters(left, depth + 1), ...collectGutters(right, depth + 1)];
}

function groupRotated<T extends LineItem>(items: T[]): T[][] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const dx = item.dx ?? 0;
    const dy = item.dy ?? 1;
    const deg = Math.round((Math.atan2(dy, dx) * 180) / Math.PI / 15) * 15;
    const key = `${item.page}:${deg}`;
    const cell = buckets.get(key);
    if (cell) cell.push(item);
    else buckets.set(key, [item]);
  }
  const lines: T[][] = [];
  for (const group of buckets.values()) {
    const first = group[0]!;
    const dx = first.dx ?? 0;
    const dy = first.dy ?? 1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    group.sort(
      (a, b) =>
        a.x * px + a.y * py - (b.x * px + b.y * py) || a.x * ux + a.y * uy - (b.x * ux + b.y * uy),
    );
    let current: T[] = [];
    let base = Number.NaN;
    for (const item of group) {
      const along = item.x * px + item.y * py;
      if (current.length === 0 || Math.abs(along - base) < Math.max(3, item.fontSize * 0.35)) {
        current.push(item);
        if (Number.isNaN(base)) base = along;
      } else {
        current.sort((a, b) => a.x * ux + a.y * uy - (b.x * ux + b.y * uy));
        lines.push(current);
        current = [item];
        base = along;
      }
    }
    if (current.length > 0) {
      current.sort((a, b) => a.x * ux + a.y * uy - (b.x * ux + b.y * uy));
      lines.push(current);
    }
  }
  return lines;
}

export function lineBox<T extends LineItem>(line: T[]): LayoutBox {
  let x = Number.POSITIVE_INFINITY;
  let y = Number.NEGATIVE_INFINITY;
  let x2 = Number.NEGATIVE_INFINITY;
  let y2 = Number.POSITIVE_INFINITY;
  for (const it of line) {
    const h = Math.max(it.height, it.fontSize, 8);
    x = Math.min(x, it.x);
    y = Math.max(y, it.y + h * 0.8);
    x2 = Math.max(x2, it.x + Math.max(it.width, 0));
    y2 = Math.min(y2, it.y - h * 0.2);
  }
  if (!Number.isFinite(x)) return { x: 0, y: 0, x2: 0, y2: 0 };
  if (y2 > y) y2 = y;
  return { x, y, x2, y2 };
}

export function orderBoxes<T extends LayoutBox>(boxes: T[]): T[] {
  if (boxes.length <= 1) return boxes.slice();
  const { margin, main } = peelMargin(boxes);
  const sorted = main.length <= 1 ? main.slice() : xycut(main, 0);
  return mergeMargin(sorted, margin);
}

function peelMargin<T extends LayoutBox>(boxes: T[]): { margin: T[]; main: T[] } {
  const wide = boxes.filter((b) => b.x2 - b.x >= MARGIN_WIDTH);
  if (wide.length === 0) return { margin: [], main: boxes.slice() };
  const minX = Math.min(...wide.map((b) => b.x));
  const maxX = Math.max(...wide.map((b) => b.x2));
  const margin: T[] = [];
  const main: T[] = [];
  for (const b of boxes) {
    const leftMargin = b.x2 < minX - 1;
    const rightMargin = b.x > maxX + 1;
    if (leftMargin || rightMargin) margin.push(b);
    else main.push(b);
  }
  if (main.length === 0) return { margin: [], main: boxes.slice() };
  return { margin, main };
}

function mergeMargin<T extends LayoutBox>(main: T[], margin: T[]): T[] {
  if (margin.length === 0) return main;
  const all = main.length > 0 ? main : margin;
  const pageTop = Math.max(...all.map((b) => b.y), ...margin.map((b) => b.y));
  const pageBottom = Math.min(...all.map((b) => b.y2), ...margin.map((b) => b.y2));
  const floor = pageBottom + Math.max(pageTop - pageBottom, 1) * 0.15;
  const headers: T[] = [];
  const footers: T[] = [];
  for (const b of margin) {
    if (b.y > floor) headers.push(b);
    else footers.push(b);
  }
  return [...rowSort(headers), ...main, ...rowSort(footers)];
}

function xycut<T extends LayoutBox>(boxes: T[], depth: number): T[] {
  if (boxes.length <= 1 || depth >= MAX_DEPTH) return fallbackSort(boxes);

  const hGap = findHorizontalGap(boxes);
  const vGap = findVerticalGap(boxes);
  const analysis = vGap ? analyzeVerticalCut(boxes, vGap.split) : undefined;

  if (analysis && vGap) {
    const bands = splitVerticalBands(boxes, vGap.split, analysis);
    if (bands) {
      return [
        ...xycut(bands.top, depth + 1),
        ...xycut(bands.left, depth + 1),
        ...xycut(bands.right, depth + 1),
        ...xycut(bands.bottom, depth + 1),
      ];
    }
    const parts = partitionX(boxes, vGap.split);
    if (parts) return [...xycut(parts[0], depth + 1), ...xycut(parts[1], depth + 1)];
  }

  if (vGap && columnOverlap(boxes, vGap.split)) {
    const loose = columnBand(boxes, vGap.split);
    if (loose) {
      const bands = splitVerticalBands(boxes, vGap.split, loose);
      if (bands) {
        return [
          ...xycut(bands.top, depth + 1),
          ...xycut(bands.left, depth + 1),
          ...xycut(bands.right, depth + 1),
          ...xycut(bands.bottom, depth + 1),
        ];
      }
    }
    const parts = partitionX(boxes, vGap.split);
    if (parts) return [...xycut(parts[0], depth + 1), ...xycut(parts[1], depth + 1)];
  }

  if (hGap) {
    const parts = partitionY(boxes, hGap.split);
    if (parts) return [...xycut(parts[0], depth + 1), ...xycut(parts[1], depth + 1)];
  }
  if (vGap) {
    const parts = partitionX(boxes, vGap.split);
    if (parts) return [...xycut(parts[0], depth + 1), ...xycut(parts[1], depth + 1)];
  }
  return fallbackSort(boxes);
}

function fallbackSort<T extends LayoutBox>(boxes: T[]): T[] {
  if (boxes.length >= 3) {
    const vGap = findVerticalGap(boxes);
    if (vGap && columnOverlap(boxes, vGap.split)) {
      const parts = partitionX(boxes, vGap.split);
      if (parts) return [...rowSort(parts[0]), ...rowSort(parts[1])];
    }
  }
  return rowSort(boxes);
}

function rowSort<T extends LayoutBox>(boxes: T[]): T[] {
  return boxes.slice().sort((a, b) => {
    const ya = Math.round(a.y / Y_BUCKET);
    const yb = Math.round(b.y / Y_BUCKET);
    return yb - ya || a.x - b.x;
  });
}

interface Gap {
  split: number;
  gap: number;
}

interface VerticalCut {
  sharedTop: number;
  sharedBottom: number;
}

function findHorizontalGap(boxes: LayoutBox[]): Gap | undefined {
  if (boxes.length < 2) return undefined;
  const sorted = boxes.map((b) => ({ bottom: b.y2, top: b.y })).sort((a, b) => b.top - a.top);
  let bestGap = 0;
  let bestY: number | undefined;
  let prevBottom = sorted[0]!.bottom;
  for (let i = 1; i < sorted.length; i += 1) {
    const { bottom, top } = sorted[i]!;
    if (prevBottom > top) {
      const gap = prevBottom - top;
      if (gap > bestGap && gap > MIN_GAP) {
        bestGap = gap;
        bestY = (prevBottom + top) / 2;
      }
    }
    prevBottom = Math.min(prevBottom, bottom);
  }
  return bestY === undefined ? undefined : { split: bestY, gap: bestGap };
}

function findVerticalGap(boxes: LayoutBox[]): Gap | undefined {
  if (boxes.length < 2) return undefined;
  const fromEdges = verticalGapFromEdges(boxes);
  if (fromEdges && fromEdges.gap >= MIN_GAP) return fromEdges;

  const minX = Math.min(...boxes.map((b) => b.x));
  const maxX = Math.max(...boxes.map((b) => b.x2));
  const regionWidth = Math.max(maxX - minX, 1);
  const narrow = regionWidth * NARROW_WIDTH_RATIO;
  const filtered = boxes.filter((b) => b.x2 - b.x >= narrow);
  if (filtered.length >= 2 && filtered.length < boxes.length) {
    const retry = verticalGapFromEdges(filtered);
    if (retry && retry.gap >= MIN_GAP && (!fromEdges || retry.gap > fromEdges.gap)) return retry;
  }

  return verticalGapFromCenters(boxes);
}

function verticalGapFromEdges(boxes: LayoutBox[]): Gap | undefined {
  const minX = Math.min(...boxes.map((b) => b.x));
  const maxX = Math.max(...boxes.map((b) => b.x2));
  const contentWidth = Math.max(maxX - minX, 1);
  const spanThreshold = contentWidth * SPAN_RATIO;
  const mid = (minX + maxX) / 2;
  const half = contentWidth * 0.5;

  let intervals = boxes.flatMap((b) => {
    const w = b.x2 - b.x;
    if (w > spanThreshold) return [];
    if (w < half && b.x < mid && b.x2 > mid) return [];
    const left = b.x + BBOX_SHRINK;
    const right = b.x2 - BBOX_SHRINK;
    return right > left ? [{ left, right }] : [];
  });
  if (intervals.length < 2) {
    intervals = boxes.flatMap((b) => {
      const left = b.x + BBOX_SHRINK;
      const right = b.x2 - BBOX_SHRINK;
      return right > left ? [{ left, right }] : [];
    });
  }
  intervals.sort((a, b) => a.left - b.left || a.right - b.right);

  const merged: { left: number; right: number }[] = [];
  for (const iv of intervals) {
    const last = merged[merged.length - 1];
    if (last && iv.left <= last.right + MERGE_TOL) last.right = Math.max(last.right, iv.right);
    else merged.push({ left: iv.left, right: iv.right });
  }

  let bestGap = 0;
  let bestX: number | undefined;
  for (let i = 1; i < merged.length; i += 1) {
    const gap = merged[i]!.left - merged[i - 1]!.right;
    if (gap > bestGap && gap > MIN_GAP) {
      bestGap = gap;
      bestX = (merged[i - 1]!.right + merged[i]!.left) / 2;
    }
  }
  return bestX === undefined ? undefined : { split: bestX, gap: bestGap };
}

function verticalGapFromCenters(boxes: LayoutBox[]): Gap | undefined {
  const minX = Math.min(...boxes.map((b) => b.x));
  const maxX = Math.max(...boxes.map((b) => b.x2));
  const spanThreshold = Math.max(maxX - minX, 1) * SPAN_RATIO;
  const centers = boxes
    .filter((b) => {
      const w = b.x2 - b.x;
      return w >= MIN_COL_WIDTH && w <= spanThreshold;
    })
    .map((b) => (b.x + b.x2) / 2)
    .sort((a, b) => a - b);
  let candidateX: number | undefined;
  let candidateGap = 0;
  for (let i = 1; i < centers.length; i += 1) {
    const gap = centers[i]! - centers[i - 1]!;
    if (gap > candidateGap && gap >= MIN_CENTER_GAP) {
      candidateGap = gap;
      candidateX = (centers[i - 1]! + centers[i]!) / 2;
    }
  }
  if (candidateX === undefined) return undefined;
  const rightMinLeft = Math.min(
    ...boxes.filter((b) => (b.x + b.x2) / 2 >= candidateX).map((b) => b.x),
  );
  if (rightMinLeft < candidateX * 0.85) return undefined;
  return { split: candidateX, gap: candidateGap };
}

function analyzeVerticalCut(boxes: LayoutBox[], splitX: number): VerticalCut | undefined {
  if (boxes.length < 3) return undefined;
  const minX = Math.min(...boxes.map((b) => b.x));
  const maxX = Math.max(...boxes.map((b) => b.x2));
  const spanningWidth = Math.max(maxX - minX, 1) * SPANNING_WIDTH;

  let leftCount = 0;
  let rightCount = 0;
  let leftTop = Number.NEGATIVE_INFINITY;
  let leftBottom = Number.POSITIVE_INFINITY;
  let rightTop = Number.NEGATIVE_INFINITY;
  let rightBottom = Number.POSITIVE_INFINITY;
  const crossing: { top: number; bottom: number }[] = [];

  for (const b of boxes) {
    const width = b.x2 - b.x;
    const crosses = b.x < splitX - SPLIT_MARGIN && b.x2 > splitX + SPLIT_MARGIN;
    if (crosses && width >= spanningWidth) {
      crossing.push({ top: b.y, bottom: b.y2 });
      continue;
    }
    if ((b.x + b.x2) / 2 < splitX) {
      leftCount += 1;
      leftTop = Math.max(leftTop, b.y);
      leftBottom = Math.min(leftBottom, b.y2);
    } else {
      rightCount += 1;
      rightTop = Math.max(rightTop, b.y);
      rightBottom = Math.min(rightBottom, b.y2);
    }
  }

  if (leftCount < 1 || rightCount < 1) return undefined;
  const leftHeight = Math.max(leftTop - leftBottom, 0);
  const rightHeight = Math.max(rightTop - rightBottom, 0);
  if (leftHeight <= 0 || rightHeight <= 0) return undefined;
  const overlap = Math.max(Math.min(leftTop, rightTop) - Math.max(leftBottom, rightBottom), 0);
  const overlapRatio = overlap / Math.min(leftHeight, rightHeight);
  if (overlapRatio < 0.35) return undefined;

  const sharedTop = Math.min(leftTop, rightTop);
  const sharedBottom = Math.max(leftBottom, rightBottom);
  if (sharedTop <= sharedBottom) return undefined;

  const ambiguous = crossing.some(
    (c) => c.bottom < sharedTop - BAND_TOLERANCE && c.top > sharedBottom + BAND_TOLERANCE,
  );
  if (ambiguous) return undefined;
  return { sharedTop, sharedBottom };
}

function columnBand(boxes: LayoutBox[], splitX: number): VerticalCut | undefined {
  let leftTop = Number.NEGATIVE_INFINITY;
  let leftBottom = Number.POSITIVE_INFINITY;
  let rightTop = Number.NEGATIVE_INFINITY;
  let rightBottom = Number.POSITIVE_INFINITY;
  let leftCount = 0;
  let rightCount = 0;
  for (const b of boxes) {
    const crosses = b.x < splitX - SPLIT_MARGIN && b.x2 > splitX + SPLIT_MARGIN;
    if (crosses) continue;
    if ((b.x + b.x2) / 2 < splitX) {
      leftCount += 1;
      leftTop = Math.max(leftTop, b.y);
      leftBottom = Math.min(leftBottom, b.y2);
    } else {
      rightCount += 1;
      rightTop = Math.max(rightTop, b.y);
      rightBottom = Math.min(rightBottom, b.y2);
    }
  }
  if (leftCount === 0 || rightCount === 0) return undefined;
  const sharedTop = Math.min(leftTop, rightTop);
  const sharedBottom = Math.max(leftBottom, rightBottom);
  if (sharedTop <= sharedBottom) return undefined;
  return { sharedTop, sharedBottom };
}

function columnOverlap(boxes: LayoutBox[], splitX: number): boolean {
  let leftTop = Number.NEGATIVE_INFINITY;
  let leftBottom = Number.POSITIVE_INFINITY;
  let rightTop = Number.NEGATIVE_INFINITY;
  let rightBottom = Number.POSITIVE_INFINITY;
  let leftCount = 0;
  let rightCount = 0;
  for (const b of boxes) {
    if ((b.x + b.x2) / 2 < splitX) {
      leftCount += 1;
      leftTop = Math.max(leftTop, b.y);
      leftBottom = Math.min(leftBottom, b.y2);
    } else {
      rightCount += 1;
      rightTop = Math.max(rightTop, b.y);
      rightBottom = Math.min(rightBottom, b.y2);
    }
  }
  if (leftCount === 0 || rightCount === 0) return false;
  const leftHeight = Math.max(leftTop - leftBottom, 1);
  const rightHeight = Math.max(rightTop - rightBottom, 1);
  const overlap = Math.max(Math.min(leftTop, rightTop) - Math.max(leftBottom, rightBottom), 0);
  return overlap / Math.min(leftHeight, rightHeight) >= COLUMN_OVERLAP;
}

function splitVerticalBands<T extends LayoutBox>(
  boxes: T[],
  splitX: number,
  analysis: VerticalCut,
): { top: T[]; left: T[]; right: T[]; bottom: T[] } | undefined {
  const top: T[] = [];
  const left: T[] = [];
  const right: T[] = [];
  const bottom: T[] = [];
  for (const b of boxes) {
    const crosses = b.x < splitX - SPLIT_MARGIN && b.x2 > splitX + SPLIT_MARGIN;
    if (crosses) {
      if (b.y2 >= analysis.sharedTop - BAND_TOLERANCE) {
        top.push(b);
        continue;
      }
      if (b.y <= analysis.sharedBottom + BAND_TOLERANCE) {
        bottom.push(b);
        continue;
      }
      return undefined;
    }
    if ((b.x + b.x2) / 2 < splitX) left.push(b);
    else right.push(b);
  }
  if (left.length === 0 || right.length === 0) return undefined;
  if (left.length >= 2 && right.length >= 2) return { top, left, right, bottom };
  if (!isColumnGutter(left, right, boxes)) return undefined;
  return { top, left, right, bottom };
}

function isColumnGutter(left: LayoutBox[], right: LayoutBox[], all: LayoutBox[]): boolean {
  const leftRight = Math.max(...left.map((b) => b.x2)) - BBOX_SHRINK;
  const rightLeft = Math.min(...right.map((b) => b.x)) + BBOX_SHRINK;
  const gap = rightLeft - leftRight;
  if (gap <= MIN_GAP) return false;
  const minX = Math.min(...all.map((b) => b.x));
  const maxX = Math.max(...all.map((b) => b.x2));
  const maxGutter = Math.max(72, Math.max(maxX - minX, 1) * 0.3);
  return gap <= maxGutter;
}

function partitionY<T extends LayoutBox>(boxes: T[], splitY: number): [T[], T[]] | undefined {
  const top = boxes.filter((b) => (b.y + b.y2) / 2 >= splitY);
  const bottom = boxes.filter((b) => (b.y + b.y2) / 2 < splitY);
  if (top.length === 0 || bottom.length === 0) return undefined;
  if (top.length + bottom.length !== boxes.length) return undefined;
  return [top, bottom];
}

function partitionX<T extends LayoutBox>(boxes: T[], splitX: number): [T[], T[]] | undefined {
  const left = boxes.filter((b) => (b.x + b.x2) / 2 < splitX);
  const right = boxes.filter((b) => (b.x + b.x2) / 2 >= splitX);
  if (left.length < 2 || right.length < 2) return undefined;
  if (left.length + right.length !== boxes.length) return undefined;
  return [left, right];
}
