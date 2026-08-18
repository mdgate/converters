import { ConvertError } from '@mdgate/core';
import type { Document } from '@mdgate/document';
import { cleanText } from '@mdgate/utils';
import { bulletList, dataTable, fencedDocument, titledDocument } from './doc.js';

const MAX_SMALL_KEYS = 24;
const MAX_SMALL_ROWS = 50;
const MAX_SMALL_COLS = 12;

export function jsonDocument(text: string, title: string | undefined): Document {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw ConvertError.malformed(err instanceof Error ? err.message : 'invalid json');
  }
  const structured = structuredJson(value, title);
  return structured ?? fencedDocument('json', JSON.stringify(value, null, 2));
}

export function jsonlDocument(text: string, title: string | undefined): Document {
  const values = parseJsonl(text);
  if (values.length === 0) throw ConvertError.malformed('empty jsonl');

  if (values.length <= MAX_SMALL_ROWS && values.every(isFlatObject)) {
    const keys = sharedKeys(values);
    if (keys !== undefined && keys.length > 0 && keys.length <= MAX_SMALL_COLS) {
      return titledDocument(title, (doc) => {
        doc.blocks.push(
          dataTable(
            keys,
            values.map((row) => keys.map((k) => formatScalar(row[k]))),
          ),
        );
      });
    }
  }

  const doc = titledDocument(title, () => undefined);
  for (let i = 0; i < values.length; i += 1) {
    doc.blocks.push({
      type: 'codeBlock',
      lang: 'json',
      text: JSON.stringify(values[i], null, 2),
    });
  }
  return doc;
}

export function tryJsonThenJsonl(text: string, title: string | undefined): Document {
  try {
    return jsonDocument(text, title);
  } catch (err) {
    if (looksLikeJsonl(text)) return jsonlDocument(text, title);
    throw err;
  }
}

function parseJsonl(text: string): unknown[] {
  const lines = text.split('\n');
  const values: unknown[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i]!;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      values.push(JSON.parse(trimmed));
    } catch (err) {
      throw ConvertError.malformed(
        err instanceof Error ? `jsonl line ${i + 1}: ${err.message}` : `jsonl line ${i + 1}`,
      );
    }
  }
  return values;
}

function looksLikeJsonl(text: string): boolean {
  let seen = 0;
  for (const raw of text.split('\n')) {
    const line = (raw.endsWith('\r') ? raw.slice(0, -1) : raw).trim();
    if (line.length === 0) continue;
    try {
      JSON.parse(line);
    } catch {
      return false;
    }
    seen += 1;
    if (seen >= 2) return true;
  }
  return false;
}

function structuredJson(value: unknown, title: string | undefined): Document | undefined {
  if (isFlatObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0 || keys.length > MAX_SMALL_KEYS) return undefined;
    return titledDocument(title, (doc) => {
      doc.blocks.push({
        type: 'list',
        list: {
          marker: 'bullet',
          start: 1,
          items: bulletList(keys.map((k) => `${k}: ${formatScalar(value[k])}`)),
        },
      });
    });
  }
  if (Array.isArray(value) && value.length > 0 && value.length <= MAX_SMALL_ROWS) {
    if (!value.every(isFlatObject)) return undefined;
    const keys = sharedKeys(value);
    if (keys === undefined || keys.length === 0 || keys.length > MAX_SMALL_COLS) return undefined;
    return titledDocument(title, (doc) => {
      doc.blocks.push(
        dataTable(
          keys,
          value.map((row) => keys.map((k) => formatScalar(row[k]))),
        ),
      );
    });
  }
  return undefined;
}

function sharedKeys(rows: readonly Record<string, unknown>[]): string[] | undefined {
  const first = Object.keys(rows[0]!);
  const expected = new Set(first);
  for (let i = 1; i < rows.length; i += 1) {
    const keys = Object.keys(rows[i]!);
    if (keys.length !== expected.size) return undefined;
    for (const k of keys) {
      if (!expected.has(k)) return undefined;
    }
  }
  return first;
}

function isFlatObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  for (const v of Object.values(value)) {
    if (!isScalar(v)) return false;
  }
  return true;
}

function isScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return cleanText(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}
