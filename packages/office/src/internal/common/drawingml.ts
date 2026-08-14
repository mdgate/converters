import {
  type Block,
  type Cell,
  cellFromInlines,
  type ListItem,
  plain,
  tableFromRows,
} from '../model/index.js';
import { type Element, ns } from '../package/xml.js';
import { trim } from '../unicode.js';
import { cleanText } from './text.js';

/** A chart part as blocks: bold title paragraph plus a categories × series table. */
export function chartBlocks(root: Element): Block[] {
  const blocks: Block[] = [];
  const titleEl = root.firstDescendant(ns.CHART, 'title');
  const title = titleEl !== undefined ? cleanText(drawingText(titleEl)) : '';
  if (trim(title).length > 0) {
    blocks.push({
      type: 'paragraph',
      inlines: [
        {
          type: 'text',
          text: title,
          style: { bold: true, italic: false, strike: false, code: false },
        },
      ],
    });
  }
  interface Series {
    name: string;
    values: string[];
  }
  let categories: string[] = [];
  const series: Series[] = [];
  for (const ser of root.descendants(ns.CHART, 'ser')) {
    const name =
      ser.find(ns.CHART, 'tx')?.firstDescendant(ns.CHART, 'v') !== undefined
        ? cleanText(ser.find(ns.CHART, 'tx')!.firstDescendant(ns.CHART, 'v')!.text())
        : '';
    const catEl = ser.find(ns.CHART, 'cat');
    const cats =
      catEl !== undefined
        ? [...catEl.descendants(ns.CHART, 'v')].map((v) => cleanText(v.text()))
        : [];
    if (categories.length === 0) categories = cats;
    const valEl = ser.find(ns.CHART, 'val');
    const values =
      valEl !== undefined
        ? [...valEl.descendants(ns.CHART, 'v')].map((p) => cleanText(p.text()))
        : [];
    series.push({ name, values });
  }
  if (series.length > 0 && categories.length > 0) {
    const catAx = root.firstDescendant(ns.CHART, 'catAx');
    const catTitleEl = catAx?.find(ns.CHART, 'title');
    const catTitle = catTitleEl !== undefined ? cleanText(drawingText(catTitleEl)) : '';
    const header: Cell[] = [cellFromInlines([plain(catTitle)])];
    for (const s of series) header.push(cellFromInlines([plain(s.name)]));
    const rows: Cell[][] = [header];
    for (let i = 0; i < categories.length; i += 1) {
      const row: Cell[] = [cellFromInlines([plain(categories[i]!)])];
      for (const s of series) {
        row.push(cellFromInlines([plain(s.values[i] ?? '')]));
      }
      rows.push(row);
    }
    blocks.push({ type: 'table', table: tableFromRows(rows, 1, 'data') });
  }
  return blocks;
}

/** A SmartArt data part as a bullet list of its text points in order. */
export function diagramBlocks(root: Element): Block[] {
  const items: ListItem[] = [];
  for (const pt of root.descendants(ns.DGM, 'pt')) {
    const t = pt.find(ns.DGM, 't');
    if (t === undefined) continue;
    const text = cleanText(t.text());
    if (trim(text).length === 0) continue;
    items.push({
      blocks: [{ type: 'paragraph', inlines: [plain(text)] }],
      checked: undefined,
      markerLabel: undefined,
    });
  }
  if (items.length === 0) return [];
  return [{ type: 'list', list: { marker: 'bullet', start: 1, items } }];
}

/** Text runs inside DrawingML rich text (`a:p`/`a:r`/`a:t`), joined. */
export function drawingText(elem: Element): string {
  const parts: string[] = [];
  for (const p of elem.descendants(ns.A, 'p')) {
    const text = p.text();
    if (trim(text).length > 0) parts.push(text);
  }
  return parts.length === 0 ? elem.text() : parts.join(' ');
}
