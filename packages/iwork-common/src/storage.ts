import {
  type Block,
  type Inline,
  inlinesAreEmpty,
  inlinesToPlainText,
  PLAIN,
  plain,
  type Style,
} from '@mdgate/document';
import type { IWorkArchive } from './archive.js';
import { deref, getObject } from './archive.js';
import {
  decodeMessage,
  fieldBytes,
  fieldMessages,
  fieldString,
  fieldVarint,
  type ProtoField,
  readReference,
} from './protobuf.js';
import { TYPE } from './types.js';

/**
 * Convert a TSWP.StorageArchive into document blocks (paragraphs / headings).
 * Character styles map to bold/italic/strike; outline_level → heading.
 */
export function storageToBlocks(archive: IWorkArchive, storage: ProtoField[]): Block[] {
  const textParts = collectStrings(storage, 3);
  if (textParts.length === 0) return [];
  const text = textParts.join('');
  const runes = [...text];

  const paraEntries = attributeEntries(storage, 5);
  const charEntries = attributeEntries(storage, 8);
  const listEntries = attributeEntries(storage, 7);

  const blocks: Block[] = [];
  if (paraEntries.length === 0) {
    const inlines = sliceInlines(archive, runes, 0, runes.length, charEntries);
    if (!inlinesAreEmpty(inlines)) blocks.push({ type: 'paragraph', inlines });
    return blocks;
  }

  for (let i = 0; i < paraEntries.length; i += 1) {
    const start = paraEntries[i]!.index;
    const end = i + 1 < paraEntries.length ? paraEntries[i + 1]!.index : runes.length;
    if (start >= end || start >= runes.length) continue;

    const styleObj = getObject(archive, paraEntries[i]!.objectId);
    const { level, emphasis } = paragraphStyle(archive, styleObj?.fields);
    const inlines = sliceInlines(archive, runes, start, end, charEntries, emphasis);
    if (inlinesAreEmpty(inlines)) continue;

    // List styles present — emit as plain paragraphs for v1 (markers lost).
    void listEntries;

    if (level !== undefined && level >= 1 && level <= 6) {
      blocks.push({
        type: 'heading',
        level,
        anchor: inlinesToPlainText(inlines),
        content: inlines,
      });
    } else {
      blocks.push({ type: 'paragraph', inlines });
    }
  }
  return blocks;
}

export function storageObjectToBlocks(archive: IWorkArchive, objId: number | undefined): Block[] {
  const obj = getObject(archive, objId);
  if (obj === undefined) return [];
  if (obj.type !== TYPE.TSWP_STORAGE && obj.type !== TYPE.TSWP_STORAGE_ALT) {
    // Might still be storage-shaped.
  }
  return storageToBlocks(archive, obj.fields);
}

interface AttrEntry {
  index: number;
  objectId: number | undefined;
}

function attributeEntries(fields: readonly ProtoField[], field: number): AttrEntry[] {
  const table = fieldBytes(fields, field);
  if (table === undefined) return [];
  const entries: AttrEntry[] = [];
  for (const entry of fieldMessages(decodeMessage(table), 1)) {
    const index = fieldVarint(entry, 1);
    if (index === undefined) continue;
    entries.push({
      index,
      objectId: readReference(fieldBytes(entry, 2)),
    });
  }
  return entries;
}

function collectStrings(fields: readonly ProtoField[], field: number): string[] {
  const out: string[] = [];
  for (const f of fields) {
    if (f.field !== field || f.value.kind !== 'bytes') continue;
    out.push(new TextDecoder('utf-8').decode(f.value.value));
  }
  return out;
}

function sliceInlines(
  archive: IWorkArchive,
  runes: string[],
  start: number,
  end: number,
  charEntries: AttrEntry[],
  base: Style = PLAIN,
): Inline[] {
  const inlines: Inline[] = [];
  let pos = start;
  const relevant = charEntries.filter((e) => e.index >= start && e.index < end);

  const pushText = (from: number, to: number, style: Style): void => {
    if (from >= to) return;
    const text = runes.slice(from, to).join('');
    if (text.length === 0) return;
    inlines.push({ type: 'text', text, style });
  };

  if (relevant.length === 0) {
    pushText(start, Math.min(end, runes.length), base);
    return inlines;
  }

  for (let i = 0; i < relevant.length; i += 1) {
    const cs = relevant[i]!.index;
    const ce = i + 1 < relevant.length ? relevant[i + 1]!.index : end;
    const clipEnd = Math.min(ce, end);
    if (cs > pos) {
      pushText(pos, Math.min(cs, end), base);
      pos = cs;
    }
    if (cs >= end) break;
    const styleObj = getObject(archive, relevant[i]!.objectId);
    const style = mergeStyle(base, characterStyle(archive, styleObj?.fields));
    pushText(cs, clipEnd, style);
    pos = clipEnd;
  }
  if (pos < end) pushText(pos, Math.min(end, runes.length), base);

  // Drop leading/trailing paragraph separators that iWork embeds as \n/\u2029/\u2028.
  return trimParaSeparators(inlines);
}

function trimParaSeparators(inlines: Inline[]): Inline[] {
  const cleaned = inlines.map((inline) => {
    if (inline.type !== 'text') return inline;
    return {
      ...inline,
      text: inline.text.replace(/\u2029/g, '').replace(/\u2028/g, '\n'),
    };
  });
  // Trailing newline often marks paragraph end in the storage buffer.
  const last = cleaned[cleaned.length - 1];
  if (last?.type === 'text' && last.text.endsWith('\n')) {
    const text = last.text.replace(/\n+$/, '');
    if (text.length === 0) return cleaned.slice(0, -1);
    return [...cleaned.slice(0, -1), { ...last, text }];
  }
  return cleaned;
}

function paragraphStyle(
  archive: IWorkArchive,
  fields: ProtoField[] | undefined,
): { level: number | undefined; emphasis: Style } {
  if (fields === undefined) return { level: undefined, emphasis: PLAIN };
  const para = fieldBytes(fields, 12);
  const char = fieldBytes(fields, 11);
  let level: number | undefined;
  if (para !== undefined) {
    level = fieldVarint(decodeMessage(para), 27);
  }
  // Inherit parent style (TSS.StyleArchive.super.parent at field 1 → 3).
  const superMsg = fieldBytes(fields, 1);
  if (superMsg !== undefined) {
    const parentId = readReference(fieldBytes(decodeMessage(superMsg), 3));
    const parent = getObject(archive, parentId);
    if (parent !== undefined) {
      const inherited = paragraphStyle(archive, parent.fields);
      if (level === undefined) level = inherited.level;
      return {
        level,
        emphasis: mergeStyle(inherited.emphasis, characterProps(char)),
      };
    }
  }
  return { level, emphasis: characterProps(char) };
}

function characterStyle(archive: IWorkArchive, fields: ProtoField[] | undefined): Style {
  if (fields === undefined) return PLAIN;
  const char = fieldBytes(fields, 11);
  const style = characterProps(char);
  const superMsg = fieldBytes(fields, 1);
  if (superMsg !== undefined) {
    const parentId = readReference(fieldBytes(decodeMessage(superMsg), 3));
    const parent = getObject(archive, parentId);
    if (parent !== undefined) {
      return mergeStyle(characterStyle(archive, parent.fields), style);
    }
  }
  return style;
}

function characterProps(bytes: Uint8Array | undefined): Style {
  if (bytes === undefined) return PLAIN;
  const fields = decodeMessage(bytes);
  const bold = fieldVarint(fields, 1) === 1;
  const italic = fieldVarint(fields, 2) === 1;
  const strike = (fieldVarint(fields, 12) ?? 0) > 0;
  return { bold, italic, strike, code: false };
}

function mergeStyle(base: Style, over: Style): Style {
  return {
    bold: over.bold || base.bold,
    italic: over.italic || base.italic,
    strike: over.strike || base.strike,
    code: over.code || base.code,
  };
}

/** Follow a shape / placeholder drawable to its contained TSWP storage. */
export function shapeStorageBlocks(
  archive: IWorkArchive,
  obj: { type: number; fields: ProtoField[] },
): Block[] {
  // TSWP.ShapeInfoArchive: containedStorage = 2; super (TSD.ShapeArchive) = 1
  // KN/TP PlaceholderArchive: super ShapeInfo at field 1
  if (
    obj.type === TYPE.TSWP_SHAPE_INFO ||
    obj.type === TYPE.TP_PLACEHOLDER ||
    obj.type === TYPE.KN_PLACEHOLDER
  ) {
    let fields = obj.fields;
    if (obj.type === TYPE.TP_PLACEHOLDER || obj.type === TYPE.KN_PLACEHOLDER) {
      const shape = deref(archive, fields, 1);
      if (shape !== undefined) fields = shape.fields;
    }
    const storage = deref(archive, fields, 2);
    if (storage !== undefined) return storageToBlocks(archive, storage.fields);
  }
  return [];
}

export function plainParagraph(text: string): Block {
  return { type: 'paragraph', inlines: [plain(text)] };
}

export function fieldStringOrEmpty(fields: readonly ProtoField[], field: number): string {
  return fieldString(fields, field) ?? '';
}
