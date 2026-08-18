import { cleanText } from '@mdgate/utils';
import type { CellFormat } from './numfmt.js';

/** One typed spreadsheet cell. */
export type CellValue =
  | { kind: 'empty' }
  | { kind: 'string'; value: string }
  | { kind: 'float'; value: number }
  | { kind: 'int'; value: number }
  | { kind: 'bool'; value: boolean }
  | { kind: 'error'; name: string }
  | { kind: 'datetime'; value: number; duration: boolean; is1904: boolean }
  | { kind: 'datetimeIso'; value: string }
  | { kind: 'durationIso'; value: string };

export const EMPTY: CellValue = { kind: 'empty' };

export function isEmptyValue(v: CellValue): boolean {
  return v.kind === 'empty';
}

/** Apply a cell's number format to a float. */
export function formatExcelF64(
  value: number,
  format: CellFormat | undefined,
  is1904: boolean,
): CellValue {
  if (format === 'datetime') {
    return { kind: 'datetime', value, duration: false, is1904 };
  }
  if (format === 'timedelta') {
    return { kind: 'datetime', value, duration: true, is1904 };
  }
  return { kind: 'float', value };
}

/** Apply a cell's number format to an integer. */
export function formatExcelI64(
  value: number,
  format: CellFormat | undefined,
  is1904: boolean,
): CellValue {
  if (format === 'datetime') {
    return { kind: 'datetime', value, duration: false, is1904 };
  }
  if (format === 'timedelta') {
    return { kind: 'datetime', value, duration: true, is1904 };
  }
  return { kind: 'int', value };
}

const ERROR_BY_CODE: Record<number, string> = {
  0: 'Null',
  7: 'Div0',
  15: 'Value',
  23: 'Ref',
  29: 'Name',
  36: 'Num',
  42: 'NA',
  43: 'GettingData',
};

const ERROR_BY_TEXT: Record<string, string> = {
  '#NULL!': 'Null',
  '#DIV/0!': 'Div0',
  '#VALUE!': 'Value',
  '#REF!': 'Ref',
  '#NAME?': 'Name',
  '#NUM!': 'Num',
  '#N/A': 'NA',
  '#DATA!': 'GettingData',
  '#GETTING_DATA': 'GettingData',
};

export function errorFromCode(code: number): CellValue | undefined {
  const name = ERROR_BY_CODE[code];
  return name === undefined ? undefined : { kind: 'error', name };
}

export function errorFromText(text: string): CellValue {
  const name = ERROR_BY_TEXT[text] ?? text.replace(/^#/, '');
  return { kind: 'error', name };
}

/**
 * Render a cell as display text. Strings are cleaned but not trimmed:
 * leading/trailing whitespace is source content.
 */
export function formatData(data: CellValue): string {
  switch (data.kind) {
    case 'empty':
      return '';
    case 'string':
      return cleanText(data.value);
    case 'float':
      return formatFloat(data.value);
    case 'int':
      return String(data.value);
    case 'bool':
      return data.value ? 'TRUE' : 'FALSE';
    case 'error':
      return `#${data.name}`;
    case 'datetime':
      if (data.duration) return formatDurationDays(data.value);
      if (Math.abs(data.value) < 1.0) return formatTimeOfDay(data.value);
      return formatDateTime(data.value, data.is1904) ?? formatFloat(data.value);
    case 'datetimeIso':
    case 'durationIso':
      return data.value;
  }
}

/**
 * Float formatting at the 15 significant decimal digits a spreadsheet
 * stores and displays. Shortest round-trip formatting past that surfaces
 * the binary representation (`3554.7000000000003`); 15 digits still keeps
 * small values like 0.0000004 exact.
 */
export function formatFloat(f: number): string {
  if (Number.isNaN(f)) return 'NaN';
  if (f === Number.POSITIVE_INFINITY) return 'inf';
  if (f === Number.NEGATIVE_INFINITY) return '-inf';
  const rounded = Number.parseFloat(f.toExponential(14));
  if (Number.isNaN(rounded)) return String(f);
  return rustDisplayF64(rounded);
}

/** Rust `Display` for a finite f64: decimal, no trailing zeros, no exponent. */
function rustDisplayF64(n: number): string {
  if (Object.is(n, -0)) return '0';
  const raw = n.toString();
  if (!/[eE]/.test(raw)) return raw;
  const m = raw.match(/^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/);
  if (m === null) return raw;
  const sign = m[1] === '-' ? '-' : '';
  const digits = m[2]! + (m[3] ?? '');
  const exp = Number(m[4]);
  const point = 1 + exp;
  if (point <= 0) {
    return `${sign}0.${'0'.repeat(-point)}${digits}`;
  }
  if (point >= digits.length) {
    return `${sign}${digits}${'0'.repeat(point - digits.length)}`;
  }
  const left = digits.slice(0, point);
  const right = digits.slice(point);
  return `${sign}${left}.${right}`;
}

/** Render a time-of-day serial (a fraction of a day) as `hh:mm:ss`. */
export function formatTimeOfDay(days: number): string {
  const totalSecs = Math.round(Math.abs(days) * 86_400) % 86_400;
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

/** Render an Excel duration (stored in days) as `[h]:mm:ss`. */
export function formatDurationDays(days: number): string {
  const sign = days < 0 ? '-' : '';
  const totalSecs = Math.round(Math.abs(days) * 86_400);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  return `${sign}${h}:${pad2(m)}:${pad2(s)}`;
}

const EXCEL_1900_1904_DIFF = 1462;
const MS_MULTIPLIER = 24 * 60 * 60 * 1000;
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

/**
 * Format an Excel serial as `YYYY-MM-DD HH:MM:SS`, dropping a midnight clock
 * and any sub-second fraction.
 */
function formatDateTime(serial: number, is1904: boolean): string | undefined {
  let f = is1904 ? serial + EXCEL_1900_1904_DIFF : serial;
  if (f < 60.0) f += 1.0;
  const ms = Math.round(f * MS_MULTIPLIER);
  const t = EXCEL_EPOCH_UTC + ms;
  if (!Number.isFinite(t)) return undefined;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return undefined;
  const y = d.getUTCFullYear();
  if (y < 0 || y > 9999) return undefined;
  const out = `${y}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
  return out.endsWith(' 00:00:00') ? out.slice(0, -9) : out;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
