/** RTF frontend: position-explicit lexer feeding a state machine. */

import { AssetSink } from '../../common/assets.js';
import { type BlockStyle, StyledRun } from '../../common/blockstyle.js';
import { applyDelta, rebaseEmphasis } from '../../common/delta.js';
import { fieldResult } from '../../common/fields.js';
import { flushList, type ListEntry, type ListKey } from '../../common/list.js';
import { compositeLabel } from '../../common/numbering.js';
import { cleanText } from '../../common/text.js';
import { ConvertError } from '../../error.js';
import { debug, warn } from '../../log.js';
import {
  type Block,
  type Document,
  type Inline,
  inlinesAreEmpty,
  markerIsOrdered,
  markerLabel,
  type Note,
  type NoteKind,
  PLAIN,
  type Style,
} from '../../model/index.js';
import type { MarkerKind } from '../../model/list.js';
import { trim } from '../../unicode.js';
import { Lexer, type Token } from './lexer.js';
import { TableState } from './table.js';
import {
  decodeBytes,
  type EncodingName,
  LIST_LEVELS,
  type ListLevelDef,
  type Prelude,
  parsePrelude,
} from './tables.js';

export function parse(bytes: Uint8Array): Document {
  if (!startsWithRtf(bytes)) {
    throw ConvertError.malformed('not an RTF file');
  }
  const { prelude, encoding } = parsePrelude(bytes);
  const parser = new Parser(bytes, prelude, encoding);
  parser.run();
  return parser.finish();
}

function startsWithRtf(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false;
  return (
    bytes[0] === 123 && bytes[1] === 92 && bytes[2] === 114 && bytes[3] === 116 && bytes[4] === 102
  );
}

type Capture = 'none' | 'listText' | 'fieldInstr' | 'bookmark' | 'pict';

interface CharState {
  style: Style;
  font: number | undefined;
  ucSkip: number;
  inTable: boolean;
  itap: number;
  ilvl: number;
  ls: number | undefined;
  legacyList: MarkerKind | undefined;
  outline: number | undefined;
  block: BlockStyle | undefined;
  styleBase: Style;
  suppress: boolean;
  capture: Capture;
  note: NoteKind | undefined;
}

function cloneStyle(style: Style): Style {
  return { bold: style.bold, italic: style.italic, strike: style.strike, code: style.code };
}

function defaultCharState(): CharState {
  return {
    style: cloneStyle(PLAIN),
    font: undefined,
    ucSkip: 1,
    inTable: false,
    itap: 1,
    ilvl: 0,
    ls: undefined,
    legacyList: undefined,
    outline: undefined,
    block: undefined,
    styleBase: cloneStyle(PLAIN),
    suppress: false,
    capture: 'none',
    note: undefined,
  };
}

function cloneCharState(state: CharState): CharState {
  // Share style object refs; setStyle copy-on-writes before mutate.
  return {
    style: state.style,
    font: state.font,
    ucSkip: state.ucSkip,
    inTable: state.inTable,
    itap: state.itap,
    ilvl: state.ilvl,
    ls: state.ls,
    legacyList: state.legacyList,
    outline: state.outline,
    block: state.block,
    styleBase: state.styleBase,
    suppress: state.suppress,
    capture: state.capture,
    note: state.note,
  };
}

interface FieldFrame {
  depth: number;
  instr: string;
  start: number;
}

interface NoteFrame {
  depth: number;
  start: number;
  kind: NoteKind;
}

const LEGACY_COUNTER_LS = 2147483647;
const LEGACY_INSTANCE = Number.MAX_SAFE_INTEGER;
const BARE_LISTTEXT_INSTANCE = Number.MAX_SAFE_INTEGER - 1;

/** Per-instance numbering counters with restart-on-shallower semantics. */
class Counters {
  private readonly state = new Map<number, { values: number[]; started: boolean[] }>();

  private slot(ls: number): { values: number[]; started: boolean[] } {
    let entry = this.state.get(ls);
    if (entry === undefined) {
      entry = {
        values: Array.from({ length: LIST_LEVELS }, () => 0),
        started: Array.from({ length: LIST_LEVELS }, () => false),
      };
      this.state.set(ls, entry);
    }
    return entry;
  }

  next(ls: number, level: number, start: number): number {
    const lvl = Math.min(level, LIST_LEVELS - 1);
    const entry = this.slot(ls);
    const value = entry.started[lvl]! ? entry.values[lvl]! + 1 : start;
    entry.values[lvl] = value;
    entry.started[lvl] = true;
    for (let i = lvl + 1; i < entry.started.length; i += 1) entry.started[i] = false;
    return value;
  }

  nextLabeled(
    ls: number,
    level: number,
    levels: ListLevelDef[],
  ): { value: number; label: string | undefined } {
    const lvl = Math.min(level, LIST_LEVELS - 1);
    const def = levels[lvl]!;
    const value = this.next(ls, lvl, def.start);
    const entry = this.slot(ls);
    const marker = def.marker;
    const label =
      marker === undefined
        ? undefined
        : compositeLabel(
            def.pattern,
            marker,
            value,
            (l) => levels[Math.min(l, LIST_LEVELS - 1)]!.marker ?? 'decimal',
            (l) => {
              const i = Math.min(l, LIST_LEVELS - 1);
              return entry.started[i]! ? entry.values[i]! : levels[i]!.start;
            },
          );
    return { value, label };
  }

  seed(ls: number, level: number, value: number): void {
    const lvl = Math.min(level, LIST_LEVELS - 1);
    const entry = this.slot(ls);
    entry.values[lvl] = value;
    entry.started[lvl] = true;
    for (let i = lvl + 1; i < entry.started.length; i += 1) entry.started[i] = false;
  }
}

/** Byte-level text decoding: pending code-page bytes, `\uN` fallback skips, surrogates. */
class TextDecoder {
  private readonly defaultEncoding: EncodingName;
  private pending: number[] = [];
  private skip = 0;
  private surrogate: number | undefined;

  constructor(defaultEncoding: EncodingName) {
    this.defaultEncoding = defaultEncoding;
  }

  get hasPending(): boolean {
    return this.pending.length > 0;
  }

  byte(b: number): void {
    if (this.skip > 0) this.skip -= 1;
    else this.pending.push(b);
  }

  skipChar(): boolean {
    if (this.skip > 0) {
      this.skip -= 1;
      return true;
    }
    return false;
  }

  takePending(encoding: EncodingName | undefined): string | undefined {
    const pending = this.pending;
    const n = pending.length;
    if (n === 0) return undefined;
    let ascii = true;
    for (let i = 0; i < n; i += 1) {
      if (pending[i]! > 127) {
        ascii = false;
        break;
      }
    }
    let text: string;
    if (ascii) {
      let s = '';
      for (let i = 0; i < n; i += 1) s += String.fromCharCode(pending[i]!);
      text = s;
    } else {
      text = decodeBytes(Uint8Array.from(pending), encoding ?? this.defaultEncoding);
    }
    pending.length = 0;
    return text;
  }

  unicode(param: number | undefined, ucSkip: number): string | undefined {
    this.skip = 0;
    if (param === undefined) return undefined;
    const code = param < 0 ? param + 65536 : param;
    const unit = code & 0xffff;
    const held = this.surrogate;
    this.surrogate = undefined;
    let out: string | undefined;
    if (held === undefined && unit >= 0xd800 && unit <= 0xdbff) {
      this.surrogate = unit;
      out = undefined;
    } else if (held !== undefined && unit >= 0xdc00 && unit <= 0xdfff) {
      const combined = 0x10000 + ((held - 0xd800) << 10) + (unit - 0xdc00);
      out = String.fromCodePoint(combined);
    } else {
      out = scalarFromCode(code);
    }
    this.skip = ucSkip;
    return out;
  }
}

function scalarFromCode(code: number): string | undefined {
  if (code > 0x10ffff) return undefined;
  if (code >= 0xd800 && code <= 0xdfff) return undefined;
  if (code < 0) return undefined;
  return String.fromCodePoint(code);
}

interface PictState {
  depth: number;
  hex: number[];
  binary: Uint8Array | undefined;
  format: { mediaType: string; extension: string } | undefined;
}

function emptyPict(depth: number): PictState {
  return { depth, hex: [], binary: undefined, format: undefined };
}

function pictPayload(pict: PictState): Uint8Array {
  if (pict.binary !== undefined) return pict.binary;
  const out: number[] = [];
  let high: number | undefined;
  for (const b of pict.hex) {
    const digit = hexValue(b);
    if (digit === undefined) continue;
    if (high !== undefined) {
      out.push((high << 4) | digit);
      high = undefined;
    } else {
      high = digit;
    }
  }
  return Uint8Array.from(out);
}

function hexValue(b: number): number | undefined {
  if (b >= 48 && b <= 57) return b - 48;
  if (b >= 97 && b <= 102) return b - 97 + 10;
  if (b >= 65 && b <= 70) return b - 65 + 10;
  return undefined;
}

class Destinations {
  fields: FieldFrame[] = [];
  noteFrames: NoteFrame[] = [];
  notes: Note[] = [];
  bookmark = '';
  listtext: string | undefined;
  pict: PictState | undefined;

  closeFields(depth: number, inlines: Inline[]): void {
    while (this.fields.length > 0 && this.fields[this.fields.length - 1]!.depth > depth) {
      const frame = this.fields.pop()!;
      const start = Math.min(frame.start, inlines.length);
      const content = inlines.splice(start);
      inlines.push(...fieldResult(frame.instr, content));
    }
  }

  closeNotes(depth: number, inlines: Inline[]): void {
    while (
      this.noteFrames.length > 0 &&
      this.noteFrames[this.noteFrames.length - 1]!.depth > depth
    ) {
      const frame = this.noteFrames.pop()!;
      const start = Math.min(frame.start, inlines.length);
      const content = inlines.splice(start);
      if (!inlinesAreEmpty(content)) {
        const id = `rtf${this.notes.length}`;
        this.notes.push({
          id,
          kind: frame.kind,
          blocks: [{ type: 'paragraph', inlines: content }],
        });
        inlines.push({ type: 'noteRef', id });
      }
    }
  }

  closeBookmark(stillCapturing: boolean, inlines: Inline[]): void {
    if (!stillCapturing && this.bookmark.length > 0) {
      const name = trim(this.bookmark);
      this.bookmark = '';
      if (name.length > 0) inlines.push({ type: 'anchor', id: name });
    }
  }
}

const HANDLED_WORDS = new Set([
  'u',
  'uc',
  'f',
  'b',
  'i',
  'strike',
  'striked',
  'plain',
  's',
  'par',
  'sect',
  'pard',
  'line',
  'lbr',
  'page',
  'column',
  'tab',
  'emdash',
  'endash',
  'lquote',
  'rquote',
  'ldblquote',
  'rdblquote',
  'bullet',
  'enspace',
  'emspace',
  'qmspace',
  'intbl',
  'itap',
  'trowd',
  'trhdr',
  'clmgf',
  'clmrg',
  'clvmgf',
  'clvmrg',
  'cellx',
  'cell',
  'nestcell',
  'row',
  'nestrow',
  'nesttableprops',
  'outlinelevel',
  'ilvl',
  'ls',
  'listtext',
  'pntext',
  'pnlvlblt',
  'pnlvlbody',
  'pndec',
  'field',
  'fldinst',
  'fldrslt',
  'footnote',
  'ftnalt',
  'chftn',
  'bkmkstart',
  'shppict',
  'shptxt',
  'result',
  'pict',
  'pngblip',
  'jpegblip',
  'emfblip',
  'wmetafile',
  'macpict',
  'dibitmap',
  'wbitmap',
]);

const SUPPRESSED_DESTINATIONS = new Set([
  'fonttbl',
  'colortbl',
  'stylesheet',
  'info',
  'object',
  'header',
  'footer',
  'headerl',
  'headerr',
  'headerf',
  'footerl',
  'footerr',
  'footerf',
  'ftnsep',
  'ftnsepc',
  'aftnsep',
  'aftnsepc',
  'xmlnstbl',
  'themedata',
  'colorschememapping',
  'datastore',
  'latentstyles',
  'listtable',
  'listoverridetable',
  'rsidtbl',
  'generator',
  'filetbl',
  'revtbl',
  'datafield',
  'bkmkend',
  'annotation',
  'atnid',
  'atnauthor',
  'template',
  'defchp',
  'defpap',
  'panose',
  'falt',
  'objdata',
  'blipuid',
  'nonshppict',
  'wgrffmtfilter',
  'pgdsctbl',
  'docvar',
  'sp',
  'sn',
  'sv',
  'shpinst',
  'background',
  'userprops',
  'operator',
  'author',
  'title',
  'subject',
  'keywords',
  'doccomm',
  'creatim',
  'revtim',
  'printim',
]);

class Parser {
  private readonly lexer: Lexer;
  private readonly stack: CharState[] = [];
  private state: CharState = defaultCharState();
  private readonly prelude: Prelude;
  private readonly decoder: TextDecoder;
  private recovered = false;

  private inlines: Inline[] = [];
  private blocks: Block[] = [];
  private readonly listRun: ListEntry[] = [];
  private readonly styled = new StyledRun();
  private readonly counters = new Counters();
  private readonly table = new TableState();
  private readonly dest = new Destinations();
  private readonly assets = new AssetSink();

  constructor(bytes: Uint8Array, prelude: Prelude, defaultEncoding: EncodingName) {
    this.lexer = new Lexer(bytes);
    this.prelude = prelude;
    this.decoder = new TextDecoder(defaultEncoding);
  }

  run(): void {
    for (;;) {
      const token = this.lexer.nextToken();
      if (token === undefined) break;
      this.dispatch(token);
    }
    if (this.stack.length > 0) this.recovered = true;
    if (this.recovered) warn('recovered unbalanced rtf groups');
    this.flushPending();
    this.endParagraph();
  }

  private dispatch(token: Token): void {
    switch (token.type) {
      case 'open':
        this.flushPending();
        this.stack.push(cloneCharState(this.state));
        break;
      case 'close':
        this.flushPending();
        {
          const prev = this.stack.pop();
          if (prev !== undefined) this.state = prev;
          else this.recovered = true;
        }
        this.dest.closeFields(this.stack.length, this.inlines);
        this.dest.closeNotes(this.stack.length, this.inlines);
        this.dest.closeBookmark(this.state.capture === 'bookmark', this.inlines);
        if (this.dest.pict !== undefined && this.stack.length < this.dest.pict.depth) {
          this.finishPict();
        }
        break;
      case 'word':
        this.controlWord(token.name, token.param);
        break;
      case 'symbol':
        this.controlSymbol(token.byte);
        break;
      case 'hex':
      case 'byte':
        if (this.state.capture === 'pict') {
          if (this.dest.pict !== undefined && this.stack.length === this.dest.pict.depth) {
            this.dest.pict.hex.push(token.byte);
          }
        } else if (this.acceptsText()) {
          this.decoder.byte(token.byte);
        }
        break;
      case 'bin':
        if (
          this.state.capture === 'pict' &&
          this.dest.pict !== undefined &&
          this.stack.length === this.dest.pict.depth
        ) {
          this.dest.pict.binary = token.payload;
        } else {
          debug(`skipping ${token.payload.length} bytes of embedded binary data`);
        }
        break;
    }
  }

  private acceptsText(): boolean {
    return this.state.capture !== 'none' || !this.state.suppress;
  }

  private controlSymbol(b: number): void {
    switch (b) {
      case 126:
        this.pushChar('\u00a0');
        break;
      case 45:
        break;
      case 95:
        this.pushChar('-');
        break;
      case 42:
        this.state.suppress = true;
        break;
      case 92:
      case 123:
      case 125:
        this.pushChar(String.fromCharCode(b));
        break;
      default:
        break;
    }
  }

  private controlWord(word: string, param: number | undefined): void {
    if (!HANDLED_WORDS.has(word) && !SUPPRESSED_DESTINATIONS.has(word)) return;
    if (this.textControl(word, param)) return;
    if (this.tableControl(word, param)) return;
    if (this.listControl(word, param)) return;
    if (this.objectControl(word)) return;
    if (SUPPRESSED_DESTINATIONS.has(word)) {
      this.flushPending();
      this.state.suppress = true;
      this.state.capture = 'none';
    }
  }

  private textControl(word: string, param: number | undefined): boolean {
    const on = param !== 0;
    switch (word) {
      case 'u':
        if (this.acceptsText()) {
          this.flushPending();
          const c = this.decoder.unicode(param, this.state.ucSkip);
          if (c !== undefined) this.pushText(c);
        }
        return true;
      case 'uc':
        this.state.ucSkip = Math.max(param ?? 1, 0);
        return true;
      case 'f':
        this.flushPending();
        this.state.font = param;
        return true;
      case 'b':
        this.setStyle((s) => {
          s.bold = on;
        });
        return true;
      case 'i':
        this.setStyle((s) => {
          s.italic = on;
        });
        return true;
      case 'strike':
      case 'striked':
        this.setStyle((s) => {
          s.strike = on;
        });
        return true;
      case 'plain': {
        this.flushPending();
        const font = this.state.font;
        this.state.style = cloneStyle(PLAIN);
        this.state.font = font;
        return true;
      }
      case 's': {
        const def = param !== undefined ? this.prelude.styles.get(param) : undefined;
        if (def !== undefined) {
          this.flushPending();
          this.state.outline = def.outline;
          this.state.block = def.block;
          this.state.style = applyDelta(def.delta, this.state.style);
          this.state.styleBase = cloneStyle(this.state.style);
        }
        return true;
      }
      case 'par':
      case 'sect':
        this.flushPending();
        if (this.state.note !== undefined) this.inlines.push({ type: 'lineBreak' });
        else if (!this.state.suppress) this.endParagraph();
        return true;
      case 'pard':
        this.flushPending();
        this.state.inTable = false;
        this.state.itap = 1;
        this.state.ilvl = 0;
        this.state.ls = undefined;
        this.state.legacyList = undefined;
        this.state.outline = undefined;
        this.state.block = undefined;
        this.state.styleBase = cloneStyle(PLAIN);
        return true;
      case 'line':
      case 'lbr':
      case 'page':
      case 'column':
        this.flushPending();
        if (!this.state.suppress) this.inlines.push({ type: 'lineBreak' });
        return true;
      case 'tab':
        this.pushChar(' ');
        return true;
      case 'emdash':
        this.pushChar('\u2014');
        return true;
      case 'endash':
        this.pushChar('\u2013');
        return true;
      case 'lquote':
        this.pushChar('\u2018');
        return true;
      case 'rquote':
        this.pushChar('\u2019');
        return true;
      case 'ldblquote':
        this.pushChar('\u201c');
        return true;
      case 'rdblquote':
        this.pushChar('\u201d');
        return true;
      case 'bullet':
        this.pushChar('\u2022');
        return true;
      case 'enspace':
      case 'emspace':
      case 'qmspace':
        this.pushChar(' ');
        return true;
      default:
        return false;
    }
  }

  private tableControl(word: string, param: number | undefined): boolean {
    switch (word) {
      case 'intbl':
        this.state.inTable = true;
        return true;
      case 'itap':
        this.state.itap = clampInt(param ?? 1, 0, 8);
        if (this.state.itap > 1) this.state.inTable = true;
        return true;
      case 'trowd':
        if (this.tableActive()) this.table.beginRow(Math.max(this.state.itap, 1));
        return true;
      case 'trhdr':
        if (this.tableActive()) this.table.markHeaderRow(Math.max(this.state.itap, 1));
        return true;
      case 'clmgf':
        this.pendingCellProp((p) => {
          p.mergeFirst = true;
        });
        return true;
      case 'clmrg':
        this.pendingCellProp((p) => {
          p.mergeCont = true;
        });
        return true;
      case 'clvmgf':
        this.pendingCellProp((p) => {
          p.vmergeFirst = true;
        });
        return true;
      case 'clvmrg':
        this.pendingCellProp((p) => {
          p.vmergeCont = true;
        });
        return true;
      case 'cellx':
        if (this.tableActive()) this.table.declareCell(Math.max(this.state.itap, 1), param ?? 0);
        return true;
      case 'cell':
        this.flushPending();
        if (this.tableActive()) this.endCell(1);
        return true;
      case 'nestcell':
        this.flushPending();
        if (this.tableActive()) this.endCell(Math.max(this.state.itap, 2));
        return true;
      case 'row':
        this.flushPending();
        if (this.tableActive()) this.endRow(1);
        return true;
      case 'nestrow':
        this.flushPending();
        if (this.tableActive()) this.endRow(Math.max(this.state.itap, 2));
        return true;
      case 'nesttableprops':
        this.state.suppress = false;
        return true;
      default:
        return false;
    }
  }

  private listControl(word: string, param: number | undefined): boolean {
    switch (word) {
      case 'outlinelevel':
        if (param !== undefined && param >= 0 && param < 9) {
          this.state.outline = param + 1;
        }
        return true;
      case 'ilvl':
        this.state.ilvl = clampInt(param ?? 0, 0, 8);
        return true;
      case 'ls':
        this.state.ls = param;
        return true;
      case 'listtext':
      case 'pntext':
        this.flushPending();
        this.state.capture = 'listText';
        if (this.dest.listtext === undefined) this.dest.listtext = '';
        return true;
      case 'pnlvlblt':
        this.state.legacyList = 'bullet';
        return true;
      case 'pnlvlbody':
      case 'pndec':
        this.state.legacyList = 'decimal';
        return true;
      default:
        return false;
    }
  }

  private objectControl(word: string): boolean {
    switch (word) {
      case 'field':
        this.flushPending();
        if (!this.state.suppress) {
          this.dest.fields.push({
            depth: this.stack.length,
            instr: '',
            start: this.inlines.length,
          });
        }
        return true;
      case 'fldinst':
        this.flushPending();
        if (this.dest.fields.length > 0) this.state.capture = 'fieldInstr';
        this.state.suppress = true;
        return true;
      case 'fldrslt':
        this.flushPending();
        this.state.capture = 'none';
        return true;
      case 'footnote':
        this.flushPending();
        this.state.note = 'footnote';
        this.state.suppress = false;
        this.state.capture = 'none';
        this.dest.noteFrames.push({
          depth: this.stack.length,
          start: this.inlines.length,
          kind: 'footnote',
        });
        return true;
      case 'ftnalt':
        if (this.dest.noteFrames.length > 0) {
          this.dest.noteFrames[this.dest.noteFrames.length - 1]!.kind = 'endnote';
        }
        return true;
      case 'chftn':
        return true;
      case 'bkmkstart':
        this.flushPending();
        this.state.capture = 'bookmark';
        this.state.suppress = false;
        return true;
      case 'shppict':
        this.state.suppress = false;
        return true;
      case 'shptxt':
        this.state.suppress = false;
        return true;
      case 'result':
        this.state.suppress = false;
        return true;
      case 'pict':
        if (!this.state.suppress) {
          this.flushPending();
          this.state.capture = 'pict';
          this.dest.pict = emptyPict(this.stack.length);
        }
        return true;
      case 'pngblip':
        this.setPictFormat({ mediaType: 'image/png', extension: 'png' });
        return true;
      case 'jpegblip':
        this.setPictFormat({ mediaType: 'image/jpeg', extension: 'jpg' });
        return true;
      case 'emfblip':
        this.setPictFormat({ mediaType: 'image/emf', extension: 'emf' });
        return true;
      case 'wmetafile':
        this.setPictFormat({ mediaType: 'image/wmf', extension: 'wmf' });
        return true;
      case 'macpict':
      case 'dibitmap':
      case 'wbitmap':
        this.setPictFormat(undefined);
        return true;
      default:
        return false;
    }
  }

  private setPictFormat(format: { mediaType: string; extension: string } | undefined): void {
    if (this.state.capture === 'pict' && this.dest.pict !== undefined) {
      this.dest.pict.format = format;
    }
  }

  private finishPict(): void {
    const pict = this.dest.pict;
    this.dest.pict = undefined;
    if (pict === undefined) return;
    if (pict.format === undefined) {
      debug('skipping picture in an unsupported format');
      return;
    }
    const bytes = pictPayload(pict);
    if (bytes.length === 0) return;
    const part = `pict/${this.assets.assets.length}.${pict.format.extension}`;
    const id = this.assets.add(pict.format.mediaType, part, bytes);
    this.inlines.push({ type: 'image', alt: '', source: { type: 'asset', id } });
  }

  private tableActive(): boolean {
    return !this.state.suppress && this.state.note === undefined;
  }

  private pendingCellProp(
    f: (p: {
      mergeFirst: boolean;
      mergeCont: boolean;
      vmergeFirst: boolean;
      vmergeCont: boolean;
      right: number;
    }) => void,
  ): void {
    if (this.tableActive()) f(this.table.pendingProp(Math.max(this.state.itap, 1)));
  }

  private setStyle(f: (s: Style) => void): void {
    this.flushPending();
    this.state.style = cloneStyle(this.state.style);
    f(this.state.style);
  }

  private pushChar(c: string): void {
    if (!this.acceptsText()) return;
    if (this.decoder.skipChar()) return;
    this.flushPending();
    this.pushText(c);
  }

  private flushPending(): void {
    if (!this.decoder.hasPending) return;
    const encoding =
      this.state.font !== undefined ? this.prelude.fonts.get(this.state.font) : undefined;
    const text = this.decoder.takePending(encoding);
    if (text !== undefined) this.pushText(text);
  }

  private pushText(text: string): void {
    const cleaned = cleanTextFast(text);
    if (cleaned.length === 0) return;
    switch (this.state.capture) {
      case 'listText':
        if (this.dest.listtext !== undefined) this.dest.listtext += cleaned;
        break;
      case 'fieldInstr':
        if (this.dest.fields.length > 0) {
          this.dest.fields[this.dest.fields.length - 1]!.instr += cleaned;
        }
        break;
      case 'bookmark':
        this.dest.bookmark += cleaned;
        break;
      case 'pict':
        break;
      case 'none':
        if (!this.state.suppress) {
          this.inlines.push({ type: 'text', text: cleaned, style: cloneStyle(this.state.style) });
        }
        break;
    }
  }

  private flushTopTable(): void {
    const block = this.table.takeTable(1);
    if (block !== undefined) {
      this.flushRuns();
      this.blocks.push(block);
    }
  }

  private endParagraph(): void {
    const inlines = this.inlines;
    this.inlines = [];
    const listtext = this.dest.listtext;
    this.dest.listtext = undefined;

    if (this.state.inTable) {
      this.table.pushCellParagraph(Math.max(this.state.itap, 1), this.state.block, inlines);
      return;
    }
    this.flushTopTable();

    if (this.state.block !== undefined) {
      flushList(this.blocks, this.listRun);
      this.styled.push(this.state.block, inlines, this.blocks);
      return;
    }
    if (inlinesAreEmpty(inlines)) {
      this.flushRuns();
      return;
    }
    const entry = this.listEntry(listtext);
    if (this.state.outline !== undefined) {
      this.flushRuns();
      const content = inlines;
      rebaseEmphasis(content, this.state.styleBase);
      if (entry !== undefined && markerIsOrdered(entry.key.marker)) {
        const text = `${entry.label ?? markerLabel(entry.key.marker, entry.number)} `;
        content.unshift({ type: 'text', text, style: cloneStyle(PLAIN) });
      }
      this.blocks.push({
        type: 'heading',
        level: this.state.outline,
        anchor: undefined,
        content,
      });
      return;
    }
    if (entry !== undefined) {
      this.listRun.push({
        level: entry.level,
        key: entry.key,
        number: entry.number,
        label: entry.label,
        blocks: [{ type: 'paragraph', inlines }],
      });
      return;
    }
    this.flushRuns();
    this.blocks.push({ type: 'paragraph', inlines });
  }

  private static trimmedLabel(listtext: string | undefined): string | undefined {
    if (listtext === undefined) return undefined;
    const t = trim(listtext);
    return t.length > 0 ? t : undefined;
  }

  private listEntry(
    listtext: string | undefined,
  ): { key: ListKey; level: number; number: number; label: string | undefined } | undefined {
    if (this.state.ls !== undefined) {
      const level = this.state.ilvl;
      const list = this.prelude.lists.get(this.state.ls);
      if (list !== undefined) {
        const def = list.levels[Math.min(level, LIST_LEVELS - 1)]!;
        const marker = def.marker;
        if (marker === undefined) return undefined;
        let number = 0;
        let label: string | undefined;
        if (markerIsOrdered(marker)) {
          const labeled = this.counters.nextLabeled(this.state.ls, level, list.levels);
          number = labeled.value;
          label = labeled.label;
        }
        return {
          key: { instance: this.state.ls, marker },
          level,
          number,
          label,
        };
      }
      return {
        key: { instance: this.state.ls, marker: 'bullet' },
        level,
        number: 0,
        label: Parser.trimmedLabel(listtext),
      };
    }
    if (this.state.legacyList !== undefined) {
      const marker = this.state.legacyList;
      let number = 0;
      if (markerIsOrdered(marker)) {
        const parsed = parseLegacyNumber(listtext);
        if (parsed !== undefined) {
          this.counters.seed(LEGACY_COUNTER_LS, this.state.ilvl, parsed);
          number = parsed;
        } else {
          number = this.counters.next(LEGACY_COUNTER_LS, this.state.ilvl, 1);
        }
      }
      return {
        key: { instance: LEGACY_INSTANCE, marker },
        level: this.state.ilvl,
        number,
        label: undefined,
      };
    }
    if (listtext !== undefined && trim(listtext).length > 0) {
      return {
        key: { instance: BARE_LISTTEXT_INSTANCE, marker: 'bullet' },
        level: this.state.ilvl,
        number: 0,
        label: Parser.trimmedLabel(listtext),
      };
    }
    return undefined;
  }

  private endCell(depth: number): void {
    const inlines = this.inlines;
    this.inlines = [];
    this.dest.listtext = undefined;
    this.table.endCell(depth, this.state.block, inlines);
  }

  private endRow(depth: number): void {
    if (this.table.hasPendingCell(depth) || !inlinesAreEmpty(this.inlines)) {
      this.endCell(depth);
    }
    this.table.endRow(depth);
  }

  private flushRuns(): void {
    this.styled.flush(this.blocks);
    flushList(this.blocks, this.listRun);
  }

  finish(): Document {
    for (let depth = this.table.depth(); depth >= 1; depth -= 1) {
      if (this.table.hasPartialRow(depth)) this.endRow(depth);
    }
    this.table.collapseNested();
    this.flushTopTable();
    this.flushRuns();
    return { blocks: this.blocks, notes: this.dest.notes, assets: this.assets.assets };
  }
}

/** ASCII-only body text skips the `[...text]` cleanText walk. */
function cleanTextFast(text: string): string {
  const n = text.length;
  for (let i = 0; i < n; i += 1) {
    const c = text.charCodeAt(i);
    if (c < 32 && c !== 9) return cleanText(text);
    if (c === 0x7f || c === 0xa0 || c === 0xad) return cleanText(text);
    if (c >= 0x80 && c <= 0x9f) return cleanText(text);
    if (c === 0x200b || c === 0xfeff) return cleanText(text);
  }
  return text;
}

function clampInt(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function parseLegacyNumber(listtext: string | undefined): number | undefined {
  if (listtext === undefined) return undefined;
  let digits = '';
  for (const c of listtext) {
    if (c < '0' || c > '9') break;
    digits += c;
  }
  if (digits.length === 0) return undefined;
  const n = Number(digits);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(n, 4294967295);
}
