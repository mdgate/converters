import { type Block, type Document, emptyDocument, heading, plain } from '@mdgate/document';
import {
  collectDrawableBlocks,
  getObject,
  numbersSheets,
  openIWork,
  type SheetData,
  sheetsToDocument,
  TYPE,
  tableInfoToRows,
} from '@mdgate/iwork-common';

export function parse(bytes: Uint8Array): Document {
  const archive = openIWork(bytes, 'numbers');
  const sheets = numbersSheets(archive);
  const sheetData: SheetData[] = [];
  const extra = emptyDocument();

  for (const sheet of sheets) {
    const rows: string[][] = [];
    const otherBlocks: Block[] = [];
    for (const drawableId of sheet.drawables) {
      const obj = getObject(archive, drawableId);
      if (obj === undefined) continue;
      if (obj.type === TYPE.TST_TABLE_INFO || obj.type === TYPE.TST_WP_TABLE_INFO) {
        const grid = tableInfoToRows(archive, obj.fields);
        if (grid.length > 0) {
          if (rows.length === 0) rows.push(...grid);
          else otherBlocks.push(...collectDrawableBlocks(archive, drawableId));
          continue;
        }
      }
      otherBlocks.push(...collectDrawableBlocks(archive, drawableId));
    }
    if (rows.length > 0) sheetData.push({ name: sheet.name, rows });
    if (otherBlocks.length > 0) {
      if (sheets.length > 1) extra.blocks.push(heading(2, [plain(sheet.name)]));
      extra.blocks.push(...otherBlocks);
    }
  }

  const doc = sheetsToDocument(sheetData);
  doc.blocks.push(...extra.blocks);
  return doc;
}
