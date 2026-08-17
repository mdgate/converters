import {
  type Element,
  type Package,
  parseXml,
  type Relationships,
  readRels,
  relsPartFor,
  relType,
  resolve,
} from '@mdgate/containers';
import { ConvertError } from '@mdgate/core';
import { warn } from '@mdgate/utils';
import { builtinFormatById, type CellFormat, detectCustomNumberFormat } from './numfmt.js';
import { type CellValue, errorFromText, formatExcelF64 } from './values.js';
import { fromSparse, type MergeRegion, type SheetRange, type SparseCell } from './workbook.js';

const REL_SHARED_STRINGS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings';
const REL_STYLES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles';

interface XlsxWorkbook {
  sheets: Array<{ name: string; path: string }>;
  strings: string[];
  formats: CellFormat[];
  is1904: boolean;
}

export function parseXlsxPackage(pkg: Package): SheetRange[] {
  const wb = openXlsx(pkg);
  const out: SheetRange[] = [];
  let failed = 0;
  for (const sheet of wb.sheets) {
    try {
      const range = readWorksheet(pkg, sheet.path, sheet.name, wb);
      if (range !== undefined) out.push(range);
    } catch (e) {
      if (e instanceof ConvertError && e.isFatal()) throw e;
      warn(
        `skipping unreadable sheet ${JSON.stringify(sheet.name)}: ${e instanceof Error ? e.message : String(e)}`,
      );
      failed += 1;
    }
  }
  if (wb.sheets.length > 0 && failed === wb.sheets.length) {
    throw ConvertError.malformed('no sheet in the workbook could be read');
  }
  return out;
}

function openXlsx(pkg: Package): XlsxWorkbook {
  const rootRels = readRels(pkg, '_rels/.rels');
  const office = rootRels.firstOfType(relType.OFFICE_DOCUMENT);
  let workbookPath = 'xl/workbook.xml';
  if (office !== undefined) {
    try {
      workbookPath = resolve('', office.target).path;
    } catch {
      // keep default
    }
  }
  const strings: string[] = [];
  const formats: CellFormat[] = [];
  let is1904 = false;
  const sheets: Array<{ name: string; path: string }> = [];

  const wbRels = readRels(pkg, relsPartFor(workbookPath));
  const stringsPath =
    firstRelPath(pkg, wbRels, workbookPath, REL_SHARED_STRINGS) ??
    sibling(workbookPath, 'sharedStrings.xml');
  const stylesPath =
    firstRelPath(pkg, wbRels, workbookPath, REL_STYLES) ?? sibling(workbookPath, 'styles.xml');

  const stringsXml = pkg.optionalXmlPart(stringsPath);
  if (stringsXml !== undefined) readSharedStrings(stringsXml, strings);

  const stylesXml = pkg.optionalXmlPart(stylesPath);
  if (stylesXml !== undefined) readStyles(stylesXml, formats);

  const workbookXml = pkg.optionalXmlPart(workbookPath);
  if (workbookXml !== undefined) {
    is1904 = readWorkbook(workbookXml, wbRels, workbookPath, sheets);
  } else if (pkg.hasPart(workbookPath) === false && pkg.hasPart('xl/workbook.xml')) {
    const fallback = pkg.optionalXmlPart('xl/workbook.xml');
    if (fallback !== undefined) {
      is1904 = readWorkbook(fallback, wbRels, 'xl/workbook.xml', sheets);
    }
  }

  return { sheets, strings, formats, is1904 };
}

function firstRelPath(
  pkg: Package,
  rels: Relationships,
  basePart: string,
  type: string,
): string | undefined {
  const rel = rels.firstOfType(type);
  if (rel === undefined) return undefined;
  try {
    const target = resolve(basePart, rel.target);
    if (pkg.hasPart(target.path)) return target.path;
  } catch {
    return undefined;
  }
  return undefined;
}

function sibling(part: string, name: string): string {
  const slash = part.lastIndexOf('/');
  return slash < 0 ? name : `${part.slice(0, slash + 1)}${name}`;
}

function readWorkbook(
  root: Element,
  rels: Relationships,
  workbookPath: string,
  sheets: Array<{ name: string; path: string }>,
): boolean {
  let is1904 = false;
  const wb = firstLocal(root, 'workbook') ?? root;
  for (const el of wb.childElems()) {
    if (el.local === 'workbookPr') {
      const v = el.attrAny('date1904');
      is1904 = v === '1' || v === 'true';
    }
  }
  const sheetsEl = firstLocal(wb, 'sheets');
  if (sheetsEl === undefined) return is1904;
  for (const sheet of sheetsEl.childElems()) {
    if (sheet.local !== 'sheet') continue;
    const name = sheet.attrAny('name');
    const id = sheet.attrAny('id');
    if (name === undefined || id === undefined) continue;
    const target = rels.internalTarget(id);
    if (target === undefined) {
      warn(`skipping sheet ${JSON.stringify(name)}: missing worksheet relationship`);
      continue;
    }
    let path: string;
    try {
      path = target.startsWith('/')
        ? target.replace(/^\/+/, '')
        : resolve(workbookPath, target).path;
    } catch (e) {
      warn(`skipping sheet ${JSON.stringify(name)}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    sheets.push({ name, path });
  }
  return is1904;
}

function readSharedStrings(root: Element, strings: string[]): void {
  const sst = firstLocal(root, 'sst') ?? root;
  for (const si of sst.childElems()) {
    if (si.local !== 'si') continue;
    strings.push(readRichString(si));
  }
}

function readRichString(si: Element): string {
  let out = '';
  let sawText = false;
  const visit = (el: Element, skipPhonetic: boolean): void => {
    if (el.local === 'rPh') return;
    if (el.local === 't' && !skipPhonetic) {
      sawText = true;
      const preserve = el.attr('http://www.w3.org/XML/1998/namespace', 'space') === 'preserve';
      const raw = el.text();
      out += preserve ? raw : trimAsciiWs(raw);
      return;
    }
    for (const child of el.childElems()) visit(child, skipPhonetic || el.local === 'rPh');
  };
  visit(si, false);
  return sawText ? out : '';
}

function trimAsciiWs(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isAsciiWs(s.charCodeAt(start))) start += 1;
  while (end > start && isAsciiWs(s.charCodeAt(end - 1))) end -= 1;
  return s.slice(start, end);
}

function isAsciiWs(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13;
}

function readStyles(root: Element, formats: CellFormat[]): void {
  const sheet = firstLocal(root, 'styleSheet') ?? root;
  const numberFormats = new Map<string, string>();
  const numFmts = firstLocal(sheet, 'numFmts');
  if (numFmts !== undefined) {
    for (const fmt of numFmts.childElems()) {
      if (fmt.local !== 'numFmt') continue;
      const id = fmt.attrAny('numFmtId');
      const code = fmt.attrAny('formatCode');
      if (id !== undefined && code !== undefined) numberFormats.set(id, code);
    }
  }
  const cellXfs = firstLocal(sheet, 'cellXfs');
  if (cellXfs === undefined) return;
  for (const xf of cellXfs.childElems()) {
    if (xf.local !== 'xf') continue;
    const id = xf.attrAny('numFmtId');
    if (id === undefined) {
      formats.push('other');
      continue;
    }
    const custom = numberFormats.get(id);
    formats.push(custom !== undefined ? detectCustomNumberFormat(custom) : builtinFormatById(id));
  }
}

function readWorksheet(
  pkg: Package,
  path: string,
  name: string,
  wb: XlsxWorkbook,
): SheetRange | undefined {
  const bytes = pkg.optionalPart(path);
  if (bytes === undefined) return undefined;
  let root: Element;
  try {
    root = parseXml(bytes);
  } catch (e) {
    if (e instanceof ConvertError && e.isFatal()) throw e;
    throw e;
  }
  const ws = firstLocal(root, 'worksheet') ?? root;
  const sheetData = firstLocal(ws, 'sheetData');
  if (sheetData === undefined) return undefined;

  const cells: SparseCell[] = [];
  for (const rowEl of sheetData.childElems()) {
    if (rowEl.local !== 'row') continue;
    let rowIndex: number | undefined;
    const rawRow = rowEl.attrAny('r');
    if (rawRow !== undefined) {
      const parsed = Number.parseInt(rawRow, 10);
      if (Number.isFinite(parsed) && parsed > 0) rowIndex = parsed - 1;
    }
    let colCursor = 0;
    for (const cEl of rowEl.childElems()) {
      if (cEl.local !== 'c') continue;
      const pos = parseCellRef(cEl.attrAny('r'));
      const row = pos?.row ?? rowIndex ?? 0;
      const col = pos?.col ?? colCursor;
      colCursor = col + 1;
      const value = readCellValue(cEl, wb);
      if (value.kind === 'empty') continue;
      cells.push({ row, col, value });
    }
  }

  const dense = fromSparse(cells);
  if (dense === undefined) return undefined;

  const merges: MergeRegion[] = [];
  try {
    const mergeEl = firstLocal(ws, 'mergeCells');
    if (mergeEl !== undefined) {
      for (const mc of mergeEl.childElems()) {
        if (mc.local !== 'mergeCell') continue;
        const ref = mc.attrAny('ref');
        if (ref === undefined) continue;
        const dim = parseDimension(ref);
        if (dim !== undefined) merges.push(dim);
      }
    }
  } catch (e) {
    warn(
      `skipping unreadable merged-region list for ${JSON.stringify(name)}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return { name, ...dense, merges };
}

function readCellValue(cEl: Element, wb: XlsxWorkbook): CellValue {
  const typeAttr = cEl.attrAny('t');
  const styleAttr = cEl.attrAny('s');
  let format: CellFormat | undefined = 'other';
  if (styleAttr !== undefined) {
    const id = Number.parseInt(styleAttr, 10);
    format = Number.isFinite(id) ? wb.formats[id] : undefined;
  }

  let inline: string | undefined;
  let raw: string | undefined;
  for (const child of cEl.childElems()) {
    if (child.local === 'is') {
      inline = readRichString(child);
    } else if (child.local === 'v') {
      raw = child.text();
    }
  }

  if (typeAttr === 'inlineStr' || typeAttr === 'is') {
    return inline === undefined ? { kind: 'empty' } : { kind: 'string', value: inline };
  }
  if (inline !== undefined && raw === undefined) {
    return { kind: 'string', value: inline };
  }
  if (raw === undefined) return { kind: 'empty' };

  switch (typeAttr) {
    case 's': {
      if (raw.length === 0) return { kind: 'empty' };
      const idx = Number.parseInt(raw, 10);
      const s = Number.isFinite(idx) ? wb.strings[idx] : undefined;
      return s === undefined ? { kind: 'empty' } : { kind: 'string', value: s };
    }
    case 'b':
      return { kind: 'bool', value: raw !== '0' };
    case 'd':
      return { kind: 'datetimeIso', value: raw };
    case 'e':
      return errorFromText(raw);
    case 'str':
      return { kind: 'string', value: raw };
    case 'n':
    case undefined: {
      if (raw.length === 0) return { kind: 'empty' };
      const n = Number.parseFloat(raw);
      if (Number.isFinite(n) || n === Number.POSITIVE_INFINITY || n === Number.NEGATIVE_INFINITY) {
        return formatExcelF64(n, format, wb.is1904);
      }
      if (typeAttr === undefined) return { kind: 'string', value: raw };
      return { kind: 'empty' };
    }
    default:
      return { kind: 'empty' };
  }
}

export function parseCellRef(ref: string | undefined): { row: number; col: number } | undefined {
  if (ref === undefined || ref.length === 0) return undefined;
  let i = 0;
  let col = 0;
  let row = 0;
  while (i < ref.length) {
    const c = ref.charCodeAt(i);
    if (c >= 65 && c <= 90) {
      col = col * 26 + (c - 64);
    } else if (c >= 97 && c <= 122) {
      col = col * 26 + (c - 96);
    } else if (c >= 48 && c <= 57) {
      row = c - 48;
      i += 1;
      break;
    } else {
      return undefined;
    }
    i += 1;
  }
  while (i < ref.length) {
    const c = ref.charCodeAt(i);
    if (c < 48 || c > 57) return undefined;
    row = row * 10 + (c - 48);
    i += 1;
  }
  if (row < 1 || col < 1) return undefined;
  return { row: row - 1, col: col - 1 };
}

export function parseDimension(ref: string): MergeRegion | undefined {
  const colon = ref.indexOf(':');
  if (colon < 0) {
    const one = parseCellRef(ref);
    return one === undefined ? undefined : { start: [one.row, one.col], end: [one.row, one.col] };
  }
  const a = parseCellRef(ref.slice(0, colon));
  const b = parseCellRef(ref.slice(colon + 1));
  if (a === undefined || b === undefined) return undefined;
  return { start: [a.row, a.col], end: [b.row, b.col] };
}

function firstLocal(el: Element, local: string): Element | undefined {
  return el.childElems().find((c) => c.local === local);
}
