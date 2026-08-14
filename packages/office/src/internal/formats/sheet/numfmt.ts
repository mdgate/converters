/** Port of calamine `src/formats.rs` number-format classification. */

export type CellFormat = 'other' | 'datetime' | 'timedelta';

/** Check whether an Excel number format describes a date, time, or duration. */
export function detectCustomNumberFormat(format: string): CellFormat {
  let escaped = false;
  let isQuote = false;
  let brackets = 0;
  let prev = ' ';
  let hms = false;
  let ap = false;
  for (const s of format) {
    if (escaped) {
      escaped = false;
    } else if (s === '_' || s === '\\' || s === '*') {
      escaped = true;
    } else if (s === '"' && isQuote) {
      isQuote = false;
    } else if (isQuote) {
      // quoted literal
    } else if (s === '"') {
      isQuote = true;
    } else if (s === ';') {
      return 'other';
    } else if (s === '[') {
      brackets += 1;
    } else if (s === ']' && brackets === 1 && hms) {
      return 'timedelta';
    } else if (s === ']') {
      brackets = Math.max(0, brackets - 1);
    } else if ((s === 'a' || s === 'A') && !ap && brackets === 0) {
      ap = true;
    } else if (
      (s === 'p' || s === 'm' || s === '/' || s === 'P' || s === 'M') &&
      ap &&
      brackets === 0
    ) {
      return 'datetime';
    } else if (
      !ap &&
      brackets === 0 &&
      (s === 'd' ||
        s === 'm' ||
        s === 'h' ||
        s === 'y' ||
        s === 's' ||
        s === 'D' ||
        s === 'M' ||
        s === 'H' ||
        s === 'Y' ||
        s === 'S')
    ) {
      return 'datetime';
    } else if (hms && s.toLowerCase() === prev.toLowerCase()) {
      // repeated h/m/s inside [hh]
    } else {
      hms =
        prev === '[' &&
        (s === 'm' || s === 'h' || s === 's' || s === 'M' || s === 'H' || s === 'S');
    }
    prev = s;
  }
  return 'other';
}

/** Built-in Excel format ids that are dates/times (string form, as in xlsx). */
export function builtinFormatById(id: string): CellFormat {
  switch (id) {
    case '14':
    case '15':
    case '16':
    case '17':
    case '18':
    case '19':
    case '20':
    case '21':
    case '22':
    case '45':
    case '47':
      return 'datetime';
    case '46':
      return 'timedelta';
    default:
      return 'other';
  }
}

/** Built-in Excel format ids that are dates/times (numeric form, as in xls/xlsb). */
export function builtinFormatByCode(code: number): CellFormat {
  if ((code >= 14 && code <= 22) || code === 45 || code === 47) return 'datetime';
  if (code === 46) return 'timedelta';
  return 'other';
}
