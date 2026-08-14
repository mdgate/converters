/** RTF prelude tables: font table, style sheet, and list/list-override tables. */

import { decode } from '@mdgate/utils';
import { type BlockStyle, fromStyleName } from '../../common/blockstyle.js';
import { emptyDelta, mergeDelta, type StyleDelta } from '../../common/delta.js';
import { emptyNumberPattern, type NumberPattern, type NumberText } from '../../common/numbering.js';
import { warn } from '../../log.js';
import type { MarkerKind } from '../../model/index.js';
import { trimEndMatches } from '../../unicode.js';
import { destinationGroupsMulti, Lexer } from './lexer.js';

export const LIST_LEVELS = 9;

export const WINDOWS_1252 = 'windows-1252';

export type EncodingName = string;

export interface ListLevelDef {
  marker: MarkerKind | undefined;
  start: number;
  pattern: NumberPattern;
}

export function defaultLevel(): ListLevelDef {
  return { marker: 'bullet', start: 1, pattern: emptyNumberPattern() };
}

export function defaultLevels(): ListLevelDef[] {
  return Array.from({ length: LIST_LEVELS }, defaultLevel);
}

function cloneLevel(level: ListLevelDef): ListLevelDef {
  return {
    marker: level.marker,
    start: level.start,
    pattern: { text: level.pattern.text.slice(), legal: level.pattern.legal },
  };
}

function cloneLevels(levels: ListLevelDef[]): ListLevelDef[] {
  return levels.map(cloneLevel);
}

export interface ListDef {
  levels: ListLevelDef[];
}

export interface StyleDef {
  outline: number | undefined;
  delta: StyleDelta;
  block: BlockStyle | undefined;
}

function emptyStyleDef(): StyleDef {
  return { outline: undefined, delta: emptyDelta(), block: undefined };
}

export interface Prelude {
  fonts: Map<number, EncodingName>;
  styles: Map<number, StyleDef>;
  lists: Map<number, ListDef>;
}

export function decodeBytes(bytes: Uint8Array, encoding: EncodingName): string {
  if (bytes.length === 0) return '';
  return decode(bytes, encoding);
}

/** Build a number pattern from `\leveltext` + `\levelnumbers` payloads. */
function buildPattern(text: Uint8Array, positions: Uint8Array, enc: EncodingName): NumberText[] {
  if (text.length === 0) return [];
  const count = text[0]!;
  const rest = text.subarray(1);
  const chars = rest.subarray(0, Math.min(rest.length, count));
  const out: NumberText[] = [];
  const literal: number[] = [];
  const posHas = (n: number): boolean => {
    for (let i = 0; i < positions.length; i += 1) {
      if (positions[i] === n) return true;
    }
    return false;
  };
  const flush = (): void => {
    if (literal.length === 0) return;
    out.push({ type: 'literal', text: decodeBytes(Uint8Array.from(literal), enc) });
    literal.length = 0;
  };
  for (let i = 0; i < chars.length; i += 1) {
    const b = chars[i]!;
    if (b <= 8 && posHas(i + 1)) {
      flush();
      out.push({ type: 'level', level: b });
    } else {
      literal.push(b);
    }
  }
  flush();
  return out;
}

const PRELUDE_DESTS = ['fonttbl', 'stylesheet', 'listtable', 'listoverridetable'] as const;

export function parsePrelude(bytes: Uint8Array): { prelude: Prelude; encoding: EncodingName } {
  const prelude: Prelude = {
    fonts: new Map(),
    styles: new Map(),
    lists: new Map(),
  };
  const { groups, ansicpg } = destinationGroupsMulti(bytes, PRELUDE_DESTS);
  const defaultEncoding =
    ansicpg !== undefined ? codepageEncoding(Math.max(ansicpg, 0)) : WINDOWS_1252;
  const [fonttbls, stylesheets, listtables, overrides] = groups;
  for (const group of fonttbls!) {
    parseFonttbl(group, prelude.fonts, defaultEncoding);
  }
  for (const group of stylesheets!) {
    parseStylesheet(group, prelude.styles, defaultEncoding);
  }
  const byListId = new Map<number, ListDef>();
  for (const group of listtables!) {
    parseListtable(group, byListId, defaultEncoding);
  }
  for (const group of overrides!) {
    parseOverrides(group, byListId, prelude.lists, defaultEncoding);
  }
  return { prelude, encoding: defaultEncoding };
}

class LevelTextCollector {
  active: boolean | undefined;
  text: number[] = [];
  numbers: number[] = [];
  legal = false;

  byte(b: number): void {
    if (this.active === true) this.text.push(b);
    else if (this.active === false) this.numbers.push(b);
  }

  finish(marker: MarkerKind | undefined, enc: EncodingName): NumberPattern {
    const pattern =
      marker !== undefined && marker !== 'bullet'
        ? {
            text: buildPattern(Uint8Array.from(this.text), Uint8Array.from(this.numbers), enc),
            legal: this.legal,
          }
        : emptyNumberPattern();
    this.active = undefined;
    this.text = [];
    this.numbers = [];
    this.legal = false;
    return pattern;
  }

  reset(): void {
    this.active = undefined;
    this.text = [];
    this.numbers = [];
    this.legal = false;
  }
}

function parseFonttbl(
  group: Uint8Array,
  fonts: Map<number, EncodingName>,
  defaultEncoding: EncodingName,
): void {
  const lexer = new Lexer(group);
  let current: number | undefined;
  for (;;) {
    const token = lexer.nextToken();
    if (token === undefined) break;
    if (token.type === 'word') {
      if (token.name === 'f') current = token.param;
      else if (token.name === 'fcharset' && current !== undefined && token.param !== undefined) {
        fonts.set(current, charsetEncoding(token.param, defaultEncoding));
      }
    }
  }
}

/** The null style id: `\sbasedon222` means "based on nothing". */
const NULL_STYLE = 222;

function parseStylesheet(
  group: Uint8Array,
  styles: Map<number, StyleDef>,
  enc: EncodingName,
): void {
  const lexer = new Lexer(group);
  let depth = 0;
  let current: { id: number; def: StyleDef; base: number | undefined } | undefined;
  const raw = new Map<number, { def: StyleDef; base: number | undefined }>();
  const name: number[] = [];
  for (;;) {
    const token = lexer.nextToken();
    if (token === undefined) break;
    switch (token.type) {
      case 'open':
        depth += 1;
        break;
      case 'close':
        if (depth === 1 && current !== undefined) {
          const text = decodeBytes(Uint8Array.from(name), enc);
          current.def.block = fromStyleName(trimEndMatches(text, ';'));
          raw.set(current.id, { def: current.def, base: current.base });
          current = undefined;
        }
        name.length = 0;
        depth = depth > 0 ? depth - 1 : 0;
        break;
      case 'hex':
      case 'byte':
        if (depth === 1 && current !== undefined) name.push(token.byte);
        break;
      case 'word':
        switch (token.name) {
          case 's':
            current = { id: token.param ?? 0, def: emptyStyleDef(), base: undefined };
            name.length = 0;
            break;
          case 'sbasedon':
            if (current !== undefined) {
              current.base =
                token.param !== undefined && token.param !== NULL_STYLE ? token.param : undefined;
            }
            break;
          case 'outlinelevel':
            if (
              current !== undefined &&
              token.param !== undefined &&
              token.param >= 0 &&
              token.param < 9
            ) {
              current.def.outline = token.param + 1;
            }
            break;
          case 'b':
            if (current !== undefined) current.def.delta.bold = token.param !== 0;
            break;
          case 'i':
            if (current !== undefined) current.def.delta.italic = token.param !== 0;
            break;
          default:
            break;
        }
        break;
      default:
        break;
    }
  }
  for (const id of raw.keys()) {
    const chain: StyleDef[] = [];
    const seen = new Set<number>();
    let cursor: number | undefined = id;
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        warn(`style inheritance cycle at rtf style ${cursor}`);
        break;
      }
      seen.add(cursor);
      const entry = raw.get(cursor);
      if (entry === undefined) break;
      chain.push(entry.def);
      cursor = entry.base;
    }
    const resolved = emptyStyleDef();
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const def = chain[i]!;
      resolved.delta = mergeDelta(resolved.delta, def.delta);
      resolved.outline = def.outline ?? resolved.outline;
      resolved.block = def.block ?? resolved.block;
    }
    styles.set(id, resolved);
  }
}

function parseListtable(
  group: Uint8Array,
  byListId: Map<number, ListDef>,
  enc: EncodingName,
): void {
  const lexer = new Lexer(group);
  let depth = 0;
  let listDepth: number | undefined;
  let levels = defaultLevels();
  let levelIndex = 0;
  let inLevel = false;
  let listId: number | undefined;
  const collector = new LevelTextCollector();
  for (;;) {
    const token = lexer.nextToken();
    if (token === undefined) break;
    switch (token.type) {
      case 'open':
        depth += 1;
        break;
      case 'close':
        collector.active = undefined;
        if (inLevel && listDepth !== undefined && depth === listDepth + 1) {
          inLevel = false;
          if (levelIndex < LIST_LEVELS) {
            levels[levelIndex]!.pattern = collector.finish(levels[levelIndex]!.marker, enc);
          }
          levelIndex += 1;
        }
        if (listDepth === depth) {
          if (listId !== undefined) {
            byListId.set(listId, { levels: cloneLevels(levels) });
            listId = undefined;
          }
          levels = defaultLevels();
          levelIndex = 0;
          listDepth = undefined;
        }
        depth = depth > 0 ? depth - 1 : 0;
        break;
      case 'word':
        switch (token.name) {
          case 'list':
            listDepth = depth;
            listId = undefined;
            levels = defaultLevels();
            levelIndex = 0;
            break;
          case 'listid':
            if (listDepth !== undefined) listId = token.param;
            break;
          case 'listlevel':
            inLevel = true;
            collector.reset();
            break;
          case 'levelnfc':
          case 'levelnfcn':
            if (inLevel && levelIndex < LIST_LEVELS) {
              levels[levelIndex]!.marker = markerForNfc(token.param ?? 0);
            }
            break;
          case 'levelstartat':
            if (inLevel && levelIndex < LIST_LEVELS && token.param !== undefined) {
              levels[levelIndex]!.start = Math.max(token.param, 0);
            }
            break;
          case 'leveltext':
            if (inLevel) collector.active = true;
            break;
          case 'levelnumbers':
            if (inLevel) collector.active = false;
            break;
          case 'levellegal':
            if (inLevel) collector.legal = token.param !== 0;
            break;
          default:
            break;
        }
        break;
      case 'hex':
      case 'byte':
        collector.byte(token.byte);
        break;
      default:
        break;
    }
  }
}

type RawLevelText = { text: number[]; numbers: number[]; legal: boolean };

function parseOverrides(
  group: Uint8Array,
  byListId: Map<number, ListDef>,
  lists: Map<number, ListDef>,
  enc: EncodingName,
): void {
  const lexer = new Lexer(group);
  let depth = 0;
  let overDepth: number | undefined;
  let lfoDepth: number | undefined;
  let listId: number | undefined;
  let ls: number | undefined;
  let levelIndex = 0;
  let starts: Array<number | undefined> = Array.from({ length: LIST_LEVELS }, () => undefined);
  let markers: Array<MarkerKind | undefined | null> = Array.from(
    { length: LIST_LEVELS },
    () => null,
  );
  let texts: Array<RawLevelText | undefined> = Array.from({ length: LIST_LEVELS }, () => undefined);
  const collector = new LevelTextCollector();

  const flush = (): void => {
    if (ls !== undefined && listId !== undefined) {
      const found = byListId.get(listId);
      const def: ListDef = {
        levels: found !== undefined ? cloneLevels(found.levels) : defaultLevels(),
      };
      for (let level = 0; level < LIST_LEVELS; level += 1) {
        const m = markers[level];
        if (m !== null) def.levels[level]!.marker = m;
        const s = starts[level];
        if (s !== undefined) def.levels[level]!.start = s;
        const raw = texts[level];
        if (
          raw !== undefined &&
          def.levels[level]!.marker !== undefined &&
          def.levels[level]!.marker !== 'bullet'
        ) {
          def.levels[level]!.pattern = {
            text: buildPattern(Uint8Array.from(raw.text), Uint8Array.from(raw.numbers), enc),
            legal: raw.legal,
          };
        }
      }
      lists.set(ls, def);
    }
    ls = undefined;
    listId = undefined;
    starts = Array.from({ length: LIST_LEVELS }, () => undefined);
    markers = Array.from({ length: LIST_LEVELS }, () => null);
    texts = Array.from({ length: LIST_LEVELS }, () => undefined);
  };

  for (;;) {
    const token = lexer.nextToken();
    if (token === undefined) break;
    switch (token.type) {
      case 'open':
        depth += 1;
        break;
      case 'close':
        collector.active = undefined;
        if (lfoDepth === depth) {
          lfoDepth = undefined;
          if (levelIndex < LIST_LEVELS && collector.text.length > 0) {
            texts[levelIndex] = {
              text: collector.text,
              numbers: collector.numbers,
              legal: collector.legal,
            };
          }
          collector.reset();
          levelIndex += 1;
        }
        if (overDepth === depth) {
          flush();
          levelIndex = 0;
          overDepth = undefined;
        }
        depth = depth > 0 ? depth - 1 : 0;
        break;
      case 'word':
        switch (token.name) {
          case 'listoverride':
            flush();
            overDepth = depth;
            levelIndex = 0;
            break;
          case 'listid':
            if (overDepth !== undefined) listId = token.param;
            break;
          case 'ls':
            if (overDepth !== undefined) ls = token.param;
            break;
          case 'lfolevel':
            lfoDepth = depth;
            collector.reset();
            break;
          case 'levelstartat':
            if (lfoDepth !== undefined && levelIndex < LIST_LEVELS && token.param !== undefined) {
              starts[levelIndex] = Math.max(token.param, 0);
            }
            break;
          case 'levelnfc':
          case 'levelnfcn':
            if (lfoDepth !== undefined && levelIndex < LIST_LEVELS) {
              markers[levelIndex] = markerForNfc(token.param ?? 0);
            }
            break;
          case 'leveltext':
            if (lfoDepth !== undefined) collector.active = true;
            break;
          case 'levelnumbers':
            if (lfoDepth !== undefined) collector.active = false;
            break;
          case 'levellegal':
            if (lfoDepth !== undefined) collector.legal = token.param !== 0;
            break;
          default:
            break;
        }
        break;
      case 'hex':
      case 'byte':
        collector.byte(token.byte);
        break;
      default:
        break;
    }
  }
  flush();
}

/** MS-OSHARED numbering formats -> marker kinds. `undefined` = no number. */
function markerForNfc(nfc: number): MarkerKind | undefined {
  switch (nfc) {
    case 0:
      return 'decimal';
    case 1:
      return 'upperRoman';
    case 2:
      return 'lowerRoman';
    case 3:
      return 'upperAlpha';
    case 4:
      return 'lowerAlpha';
    case 23:
      return 'bullet';
    case 255:
      return undefined;
    default:
      return 'decimal';
  }
}

function charsetEncoding(charset: number, defaultEncoding: EncodingName): EncodingName {
  switch (charset) {
    case 0:
    case 1:
      return defaultEncoding;
    case 128:
      return 'shiftjis';
    case 129:
      return 'euc-kr';
    case 134:
      return 'gbk';
    case 136:
      return 'big5';
    case 161:
      return 'windows-1253';
    case 162:
      return 'windows-1254';
    case 163:
      return 'windows-1258';
    case 177:
      return 'windows-1255';
    case 178:
    case 179:
    case 180:
      return 'windows-1256';
    case 186:
      return 'windows-1257';
    case 204:
      return 'windows-1251';
    case 222:
      return 'windows-874';
    case 238:
      return 'windows-1250';
    default:
      return defaultEncoding;
  }
}

export function codepageEncoding(cp: number): EncodingName {
  switch (cp) {
    case 932:
      return 'shiftjis';
    case 936:
      return 'gbk';
    case 949:
      return 'euc-kr';
    case 950:
      return 'big5';
    case 1250:
      return 'windows-1250';
    case 1251:
      return 'windows-1251';
    case 1253:
      return 'windows-1253';
    case 1254:
      return 'windows-1254';
    case 1255:
      return 'windows-1255';
    case 1256:
      return 'windows-1256';
    case 1257:
      return 'windows-1257';
    case 1258:
      return 'windows-1258';
    case 874:
      return 'windows-874';
    default:
      return WINDOWS_1252;
  }
}
