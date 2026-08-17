import {
  type Cell,
  type Document,
  emptyDocument,
  heading,
  type ListItem,
  plain,
  tableFromRows,
} from '@mdgate/document';
import { cleanText } from '@mdgate/utils';

export function fencedDocument(lang: string, text: string): Document {
  const doc = emptyDocument();
  doc.blocks.push({ type: 'codeBlock', lang, text });
  return doc;
}

export function titledDocument(
  title: string | undefined,
  build: (doc: Document) => void,
): Document {
  const doc = emptyDocument();
  if (title !== undefined && title.length > 0) {
    doc.blocks.push(heading(1, [plain(cleanText(title))]));
  }
  build(doc);
  return doc;
}

export function bulletList(entries: readonly string[]): ListItem[] {
  return entries.map((text) => ({
    blocks: [{ type: 'paragraph', inlines: [plain(text)] }],
    checked: undefined,
    markerLabel: undefined,
  }));
}

export function textCell(text: string): Cell {
  return {
    blocks: [{ type: 'paragraph', inlines: [plain(text)] }],
    colSpan: 1,
    rowSpan: 1,
  };
}

export function dataTable(
  headers: readonly string[],
  rows: readonly string[][],
): Document['blocks'][number] {
  const cells: Cell[][] = [
    headers.map(textCell),
    ...rows.map((row) => headers.map((_, i) => textCell(row[i] ?? ''))),
  ];
  return { type: 'table', table: tableFromRows(cells, 1, 'data') };
}
