/** CSV and friends (semicolon, tab, pipe delimited).
 *
 * Field content is preserved as written (RFC 4180: spaces are part of the
 * field); only control characters are cleaned. Encoding is detected from
 * the BOM (UTF-8, UTF-16LE/BE), then UTF-8, then Windows-1252. The
 * delimiter is chosen by trial-parsing candidates and scoring record
 * consistency, so delimiters inside quoted fields don't skew the choice. The
 * format marks no header row, so the shape of the data decides whether the
 * first record is one.
 *
 * CSV is signature-less: callers name it via the path extension.
 */

import {
  type Cell,
  type Document,
  emptyDocument,
  PLAIN,
  resolveHeaderRows,
  tableFromRows,
} from '@mdgate/document';
import { cleanText } from '@mdgate/utils';

const CANDIDATES = [',', ';', '\t', '|'] as const;
const SNIFF_RECORDS = 20;
const QUOTE = 34; // "

/** encoding_rs / WHATWG windows-1252 for bytes 0x80–0x9F. */
const WIN1252_80_9F =
  '\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178';

const END = 0;
const START_RECORD = 1;
const START_FIELD = 2;
const IN_FIELD = 3;
const IN_QUOTED = 4;
const IN_DBL_QUOTE = 5;
const END_FIELD_DELIM = 6;
const END_FIELD_TERM = 7;
const IN_RECORD_TERM = 8;
const END_RECORD = 9;
const CRLF = 10;

export function parse(bytes: Uint8Array): Document {
  const text = stripUtf8Bom(decode(bytes));
  const delimiter = sniffDelimiter(text);
  const records = parseRecords(text, delimiter);

  const rows: Cell[][] = new Array(records.length);
  for (let r = 0; r < records.length; r += 1) {
    const record = records[r]!;
    const row: Cell[] = new Array(record.length);
    for (let c = 0; c < record.length; c += 1) {
      row[c] = {
        blocks: [
          {
            type: 'paragraph',
            inlines: [{ type: 'text', text: cleanField(record[c]!), style: PLAIN }],
          },
        ],
        colSpan: 1,
        rowSpan: 1,
      };
    }
    rows[r] = row;
  }

  const doc = emptyDocument();
  const table = tableFromRows(rows, 0, 'data');
  table.headerRows = resolveHeaderRows(table, 0);
  if (table.grid.length > 0) {
    doc.blocks.push({ type: 'table', table });
  }
  return doc;
}

function decode(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes);
  }
  const rest =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? bytes.subarray(3)
      : bytes;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(rest);
  } catch {
    return decodeWindows1252(rest);
  }
}

function decodeWindows1252(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i]!;
    if (b < 0x80 || b >= 0xa0) out += String.fromCharCode(b);
    else out += WIN1252_80_9F[b - 0x80]!;
  }
  return out;
}

/** rust-csv strips a leading UTF-8 BOM from the decoded byte stream. */
function stripUtf8Bom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Printable ASCII is a cleanText identity; otherwise reuse the shared cleaner. */
function cleanField(text: string): string {
  const n = text.length;
  for (let i = 0; i < n; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return cleanText(text);
  }
  return text;
}

/** Trial-parse each candidate over the leading records and score by field
 * consistency; comma wins ties. */
function sniffDelimiter(text: string): string {
  let best = ',';
  let bestScore = 0;
  for (const d of CANDIDATES) {
    const counts = countRecordWidths(text, d.charCodeAt(0), SNIFF_RECORDS);
    if (counts.length === 0) continue;
    const tally = new Map<number, number>();
    for (const c of counts) tally.set(c, (tally.get(c) ?? 0) + 1);
    let modal = 0;
    let freq = 0;
    for (const [count, f] of tally) {
      if (f > freq || (f === freq && count > modal)) {
        freq = f;
        modal = count;
      }
    }
    if (modal < 2) continue;
    const score = freq * 1000 + Math.min(modal, 500);
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

function isTermCode(c: number): boolean {
  return c === 10 || c === 13;
}

/** Same rust-csv 1.4 NFA as parseRecords, but only field counts. */
function countRecordWidths(text: string, delim: number, limit: number): number[] {
  const counts: number[] = [];
  let nFields = 0;
  let state = START_RECORD;
  const n = text.length;
  let i = 0;

  while (i < n) {
    const c = text.charCodeAt(i);
    let action = 2;
    switch (state) {
      case END:
        action = 2;
        break;
      case START_RECORD:
        if (isTermCode(c)) {
          action = 2;
        } else {
          state = START_FIELD;
          action = 0;
        }
        break;
      case END_RECORD:
        state = START_RECORD;
        action = 0;
        break;
      case START_FIELD:
        if (c === QUOTE) {
          state = IN_QUOTED;
          action = 2;
        } else if (c === delim) {
          state = END_FIELD_DELIM;
          action = 2;
        } else if (isTermCode(c)) {
          state = END_FIELD_TERM;
          action = 0;
        } else {
          state = IN_FIELD;
          action = 1;
        }
        break;
      case END_FIELD_DELIM:
        state = START_FIELD;
        action = 0;
        break;
      case END_FIELD_TERM:
        state = IN_RECORD_TERM;
        action = 0;
        break;
      case IN_FIELD:
        if (c === delim) {
          state = END_FIELD_DELIM;
          action = 2;
        } else if (isTermCode(c)) {
          state = END_FIELD_TERM;
          action = 0;
        } else {
          action = 1;
        }
        break;
      case IN_QUOTED:
        if (c === QUOTE) {
          state = IN_DBL_QUOTE;
          action = 2;
        } else {
          action = 1;
        }
        break;
      case IN_DBL_QUOTE:
        if (c === QUOTE) {
          state = IN_QUOTED;
          action = 1;
        } else if (c === delim) {
          state = END_FIELD_DELIM;
          action = 2;
        } else if (isTermCode(c)) {
          state = END_FIELD_TERM;
          action = 0;
        } else {
          state = IN_FIELD;
          action = 1;
        }
        break;
      case IN_RECORD_TERM:
        if (c === 13) {
          state = CRLF;
          action = 2;
        } else {
          state = END_RECORD;
          action = 2;
        }
        break;
      case CRLF:
        if (c === 10) {
          state = START_RECORD;
          action = 2;
        } else {
          state = START_RECORD;
          action = 0;
        }
        break;
      default:
        state = END;
        action = 2;
        break;
    }
    if (action === 0) {
      if (state === END_FIELD_DELIM || state === END_RECORD || state === CRLF) nFields += 1;
      if (state === END_RECORD || state === CRLF) {
        counts.push(nFields);
        nFields = 0;
      }
      continue;
    }
    i += 1;
    if (state === END_FIELD_DELIM || state === END_RECORD || state === CRLF) nFields += 1;
    if (state === END_RECORD || state === CRLF) {
      counts.push(nFields);
      nFields = 0;
    }
    if (counts.length >= limit) return counts;
  }

  state = finalState(state);
  if (state === END_RECORD) {
    nFields += 1;
    counts.push(nFields);
  }
  return counts;
}

/**
 * rust-csv 1.4 NFA with default RFC 4180 knobs: quote `"`, doubled quotes,
 * CRLF/CR/LF terminators, empty lines ignored, never errors.
 * Fields are sliced from `text` instead of per-character concat.
 */
function parseRecords(text: string, delimiter: string, limit?: number): string[][] {
  const delim = delimiter.charCodeAt(0);
  const records: string[][] = [];
  let fields: string[] = [];
  let field = '';
  let runStart = -1;
  let state = START_RECORD;
  const n = text.length;
  let i = 0;

  const endRun = (end: number): void => {
    if (runStart < 0) return;
    const piece = text.slice(runStart, end);
    field = field.length === 0 ? piece : field + piece;
    runStart = -1;
  };

  const emitField = (): void => {
    endRun(i);
    fields.push(field);
    field = '';
  };
  const emitRecord = (): void => {
    records.push(fields);
    fields = [];
  };
  const takeFinal = (s: number): void => {
    if (s === END_FIELD_DELIM || s === END_RECORD || s === CRLF) emitField();
    if (s === END_RECORD || s === CRLF) emitRecord();
  };

  while (i < n) {
    const c = text.charCodeAt(i);
    let action = 2;
    switch (state) {
      case END:
        action = 2;
        break;
      case START_RECORD:
        if (isTermCode(c)) {
          action = 2;
        } else {
          state = START_FIELD;
          action = 0;
        }
        break;
      case END_RECORD:
        state = START_RECORD;
        action = 0;
        break;
      case START_FIELD:
        if (c === QUOTE) {
          state = IN_QUOTED;
          action = 2;
        } else if (c === delim) {
          state = END_FIELD_DELIM;
          action = 2;
        } else if (isTermCode(c)) {
          state = END_FIELD_TERM;
          action = 0;
        } else {
          state = IN_FIELD;
          action = 1;
        }
        break;
      case END_FIELD_DELIM:
        state = START_FIELD;
        action = 0;
        break;
      case END_FIELD_TERM:
        state = IN_RECORD_TERM;
        action = 0;
        break;
      case IN_FIELD:
        if (c === delim) {
          state = END_FIELD_DELIM;
          action = 2;
        } else if (isTermCode(c)) {
          state = END_FIELD_TERM;
          action = 0;
        } else {
          action = 1;
        }
        break;
      case IN_QUOTED:
        if (c === QUOTE) {
          state = IN_DBL_QUOTE;
          action = 2;
        } else {
          action = 1;
        }
        break;
      case IN_DBL_QUOTE:
        if (c === QUOTE) {
          state = IN_QUOTED;
          action = 1;
        } else if (c === delim) {
          state = END_FIELD_DELIM;
          action = 2;
        } else if (isTermCode(c)) {
          state = END_FIELD_TERM;
          action = 0;
        } else {
          state = IN_FIELD;
          action = 1;
        }
        break;
      case IN_RECORD_TERM:
        if (c === 13) {
          state = CRLF;
          action = 2;
        } else {
          state = END_RECORD;
          action = 2;
        }
        break;
      case CRLF:
        if (c === 10) {
          state = START_RECORD;
          action = 2;
        } else {
          state = START_RECORD;
          action = 0;
        }
        break;
      default:
        state = END;
        action = 2;
        break;
    }
    if (action === 0) {
      endRun(i);
      takeFinal(state);
      continue;
    }
    if (action === 1) {
      if (runStart < 0) runStart = i;
    } else {
      endRun(i);
    }
    i += 1;
    takeFinal(state);
    if (limit !== undefined && records.length >= limit) return records;
  }

  state = finalState(state);
  if (state === END_RECORD) {
    emitField();
    emitRecord();
  }
  return records;
}

function finalState(state: number): number {
  if (state === END || state === START_RECORD || state === END_RECORD || state === CRLF) {
    return END;
  }
  return END_RECORD;
}
