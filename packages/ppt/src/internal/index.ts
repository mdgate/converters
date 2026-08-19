/**
 * Legacy PowerPoint 97-2003 binary (.ppt): OLE2 container, record stream.
 * Slides resolve through the persist directory (the only default path);
 * text comes from TextHeaderAtom + TextCharsAtom/TextBytesAtom with
 * StyleTextPropAtom runs and TxMasterStyleAtom defaults applied. Raw
 * stream-order scanning exists only as an explicitly labelled recovery for
 * files whose persist directory is unusable. Speaker notes are included
 * (fixed policy), rendered as a quote after their slide.
 */

import { CompoundFile, getU32, readOleStream } from '@mdgate/containers';
import { ConvertError } from '@mdgate/core';
import {
  type Block,
  type Document,
  type Inline,
  inlinesAreEmpty,
  inlinesToPlainText,
  PLAIN,
  type Style,
  stylesEqual,
} from '@mdgate/document';
import {
  AssetSink,
  decodeBlip,
  fbseBlip,
  flushList,
  type ListEntry,
  rebaseEmphasis,
  recordAt,
  resolveDelta,
  type StyleDelta,
} from '@mdgate/office-common';
import { cleanText, debug, warn } from '@mdgate/utils';
import {
  type CharProps,
  emptyMasterLevel,
  emptyStyleRuns,
  type MasterLevel,
  type ParaProps,
  parseMasterStyle,
  parseStyleText,
  type StyleRuns,
} from './styletext.js';

/** One master's per-text-type level defaults, keyed by TxMasterStyleAtom instance. */
type MasterStyles = Map<number, MasterLevel[]>;

export function parse(bytes: Uint8Array): Document {
  let ole: CompoundFile;
  try {
    ole = CompoundFile.open(bytes);
  } catch (e) {
    if (e instanceof ConvertError && e.code !== 'malformed') throw e;
    const inner =
      e instanceof ConvertError && e.detail !== undefined
        ? e.detail
        : e instanceof Error
          ? e.message
          : String(e);
    throw ConvertError.malformed(`not an OLE2 compound file: ${inner}`);
  }
  const data = readOleStream(ole, 'PowerPoint Document');
  const currentUser = optionalOleStream(ole, 'Current User') ?? new Uint8Array();
  if (getU32(currentUser, 12) === 0xf3d1_c4df) {
    throw ConvertError.encrypted();
  }

  let ex = new Extractor();
  if (!ex.parseSlides(data, currentUser)) {
    // Labelled recovery path: the persist directory is unusable, so text
    // is taken in raw stream order (may include superseded edits).
    warn('ppt persist directory unusable; recovering text in raw stream order');
    ex = new Extractor();
    ex.recovering = true;
    ex.walk(data);
    ex.endSegment(undefined);
  }
  if (ex.encrypted) throw ConvertError.encrypted();
  const assets = collectPictures(ole);
  return { blocks: ex.intoBlocks(), notes: [], assets };
}

function optionalOleStream(ole: CompoundFile, name: string): Uint8Array | undefined {
  try {
    return readOleStream(ole, name);
  } catch {
    return undefined;
  }
}

/**
 * Retain the deck's embedded pictures from the `Pictures` stream (OfficeArt
 * BStore file blocks). Pictures are document-level assets; per-slide
 * placement is not resolved. Unsupported formats degrade with a log.
 */
function collectPictures(ole: CompoundFile): Document['assets'] {
  const pictures = optionalOleStream(ole, 'Pictures');
  if (pictures === undefined) return [];
  const sink = new AssetSink();
  let pos = 0;
  let index = 0;
  for (;;) {
    const rec = recordAt(pictures, pos);
    if (rec === undefined) break;
    const [verInst, recType, body] = rec;
    pos += 8 + body.length;
    index += 1;
    const blip = recType === 0xf007 ? fbseBlip(body) : decodeBlip(verInst, recType, body);
    if (blip !== undefined) {
      sink.add(blip.mediaType, `pictures/${index}.${blip.extension}`, blip.bytes);
    } else {
      debug(`skipping unsupported Pictures record 0x${recType.toString(16).padStart(4, '0')}`);
    }
  }
  return sink.assets;
}

/** Iterate the records laid out back to back in `data`. */
function* children(data: Uint8Array): Generator<[number, number, Uint8Array]> {
  let pos = 0;
  for (;;) {
    const rec = recordAt(data, pos);
    if (rec === undefined) return;
    pos += 8 + rec[2].length;
    yield rec;
  }
}

function decodeUtf16Le(body: Uint8Array): string {
  const even = body.length & ~1;
  return new TextDecoder('utf-16le').decode(body.subarray(0, even));
}

function decodeBytesAtom(body: Uint8Array): string {
  return new TextDecoder('latin1').decode(body);
}

/** A text shape being accumulated: header type, text, then styling. */
interface PendingShape {
  txType: number;
  text: string;
  styles: StyleRuns | undefined;
}

interface Segment {
  blocks: Block[];
  id: number | undefined;
  isNotes: boolean;
}

/** The persist-resolved layout of the presentation. */
interface DocLayout {
  persist: Map<number, number>;
  slideList: Uint8Array;
  notesList: Uint8Array | undefined;
  masterList: Uint8Array | undefined;
}

class Extractor {
  /** Finished segments: (blocks, pairing id, is_notes). */
  segments: Segment[] = [];
  current: Block[] = [];
  currentIsNotes = false;
  listRun: ListEntry[] = [];
  pending: PendingShape | undefined;
  /** Master style tables in master-list order: (masterId, styles). */
  masters: Array<[number, MasterStyles]> = [];
  /** Index into `masters` for the slide being extracted (0 fallback). */
  activeMaster = 0;
  shapeCounter = 0;
  encrypted = false;
  /** Raw-stream recovery: no persist lists, so notes descend inline. */
  recovering = false;
  /** Records visited across the whole extraction, capped. */
  records = 0;

  /**
   * Walk slides in presentation order: the UserEditAtom chain yields the
   * persist directory, the DocumentContainer's SlideListWithText yields
   * slide order and outline text, each slide container its own textboxes.
   * `false` means the persist directory was unusable.
   */
  parseSlides(data: Uint8Array, currentUser: Uint8Array): boolean {
    const layout = locateDocument(data, currentUser);
    if (layout === undefined) return false;
    this.masters = collectMasters(layout.masterList, layout.persist, data);
    this.walkSlideList(layout.slideList, layout.persist, data, false, 0x03ee);
    if (layout.notesList !== undefined) {
      this.walkSlideList(layout.notesList, layout.persist, data, true, 0x03f0);
    }
    return true;
  }

  walkSlideList(
    list: Uint8Array,
    persist: Map<number, number>,
    data: Uint8Array,
    isNotes: boolean,
    containerType: number,
  ): void {
    // (persistIdRef, slideId) of the page whose container is pending.
    let pending: [number, number] | undefined;
    for (const [verInst, recType, body] of children(list)) {
      if (recType === 0x03f3) {
        const id = this.finishSlide(pending, persist, data, containerType, isNotes);
        this.endSegment(id);
        this.currentIsNotes = isNotes;
        const persistRef = getU32(body, 0);
        pending = persistRef === undefined ? undefined : [persistRef, getU32(body, 12) ?? 0];
        if (!isNotes) {
          this.selectMaster(pending !== undefined ? pending[0] : undefined, persist, data);
        }
      } else {
        this.record(verInst, recType, body);
      }
    }
    const id = this.finishSlide(pending, persist, data, containerType, isNotes);
    this.endSegment(id);
  }

  /**
   * Emit a slide's own textboxes after its outline text. Returns the
   * segment's pairing id: the slideId for slides, or the owning slide's
   * id (NotesAtom slideIdRef) for notes pages.
   */
  finishSlide(
    pending: [number, number] | undefined,
    persist: Map<number, number>,
    data: Uint8Array,
    containerType: number,
    isNotes: boolean,
  ): number | undefined {
    if (pending === undefined) return undefined;
    const [persistRef, slideId] = pending;
    let id = isNotes ? undefined : slideId !== 0 ? slideId : undefined;
    const off = persist.get(persistRef);
    if (off !== undefined) {
      const rec = recordAt(data, off);
      if (rec !== undefined && rec[1] === containerType) {
        const body = rec[2];
        if (isNotes) {
          // NotesAtom.slideIdRef names the owning slide (0 = none).
          for (const [, t, atom] of children(body)) {
            if (t === 0x03f1) {
              const v = getU32(atom, 0);
              id = v !== undefined && v !== 0 ? v : undefined;
              break;
            }
          }
        }
        this.walk(body);
      }
    }
    return id;
  }

  endSegment(id: number | undefined): void {
    this.flushShape();
    flushList(this.current, this.listRun);
    if (this.current.length > 0) {
      this.segments.push({
        blocks: this.current,
        id,
        isNotes: this.currentIsNotes,
      });
      this.current = [];
    }
  }

  intoBlocks(): Block[] {
    this.endSegment(undefined);
    const slides: Array<{ id: number | undefined; blocks: Block[] }> = [];
    const notes: Array<{ id: number | undefined; blocks: Block[] }> = [];
    for (const seg of this.segments) {
      if (seg.isNotes) notes.push({ id: seg.id, blocks: seg.blocks });
      else slides.push({ id: seg.id, blocks: seg.blocks });
    }
    // Notes pages pair to slides by their stored slide id, not by list
    // position: the notes list may be sparse (notes on only some
    // slides), which order-based zipping would misattribute.
    const used = notes.map(() => false);
    const out: Block[] = [];
    for (const slide of slides) {
      out.push(...slide.blocks);
      for (let i = 0; i < notes.length; i += 1) {
        if (!used[i] && slide.id !== undefined && notes[i]!.id === slide.id) {
          used[i] = true;
          out.push({ type: 'blockQuote', blocks: notes[i]!.blocks });
          notes[i]!.blocks = [];
        }
      }
    }
    // Notes without a resolvable owner keep document order at the end.
    for (let i = 0; i < notes.length; i += 1) {
      if (!used[i] && notes[i]!.blocks.length > 0) {
        out.push({ type: 'blockQuote', blocks: notes[i]!.blocks });
      }
    }
    return out;
  }

  /**
   * Pick the master the slide references (SlideAtom.masterIdRef at
   * offset 12); the first listed master is the deterministic fallback.
   */
  selectMaster(slide: number | undefined, persist: Map<number, number>, data: Uint8Array): void {
    let found = 0;
    if (slide !== undefined) {
      const off = persist.get(slide);
      if (off !== undefined) {
        const rec = recordAt(data, off);
        if (rec !== undefined && rec[1] === 0x03ee) {
          for (const [, recType, atom] of children(rec[2])) {
            if (recType === 0x03ef) {
              const mid = getU32(atom, 12);
              if (mid !== undefined) {
                const idx = this.masters.findIndex(([id]) => id === mid);
                if (idx >= 0) found = idx;
              }
              break;
            }
          }
        }
      }
    }
    this.activeMaster = found;
  }

  /**
   * Iterative container walk over an explicit stack with fixed depth and
   * record-count bounds — nesting or record counts beyond any real
   * presentation are attack shapes and hard-fail.
   */
  walk(data: Uint8Array): void {
    const stack: Array<{ buf: Uint8Array; pos: number }> = [{ buf: data, pos: 0 }];
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const rec = recordAt(top.buf, top.pos);
      if (rec === undefined) {
        stack.pop();
        continue;
      }
      const [verInst, recType, body] = rec;
      top.pos += 8 + body.length;
      this.chargeRecord();
      if ((verInst & 0xf) !== 0xf) {
        this.atom(recType, body);
        continue;
      }
      if (recType === 0x2f14) {
        this.encrypted = true;
        continue;
      }
      if (recType === 0x03f0 && this.recovering) {
        // Notes containers are walked via the notes list; recovery
        // has no lists, so their text is taken inline (as notes).
        // A NotesAtom slideIdRef in the masters range (high bit
        // set) marks the notes master: template chrome, excluded.
        let master = false;
        for (const [, t, atom] of children(body)) {
          if (t === 0x03f1) {
            const id = getU32(atom, 0);
            master = id !== undefined && (id & 0x8000_0000) !== 0;
            break;
          }
        }
        if (!master) {
          this.endSegment(undefined);
          this.currentIsNotes = true;
          this.walk(body);
          this.endSegment(undefined);
          this.currentIsNotes = false;
        }
        continue;
      }
      if (recType === 0x03f0 || recType === 0x03f8 || recType === 0x0fc9) {
        // Notes, master, and handout containers are walked via their
        // own lists, not inline.
        continue;
      }
      if (recType === 0x0ff0 && verInst >>> 4 !== 0) {
        // Only instance 0 of SlideListWithText holds slide text here.
        continue;
      }
      stack.push({ buf: body, pos: 0 });
    }
  }

  /**
   * One record outside `walk` (slide-list traversal): containers descend
   * through the bounded walk, atoms extract directly.
   */
  record(verInst: number, recType: number, body: Uint8Array): void {
    this.chargeRecord();
    if ((verInst & 0xf) === 0xf) {
      if (recType === 0x2f14) this.encrypted = true;
      else if (recType === 0x03f0 || recType === 0x03f8 || recType === 0x0fc9) {
        /* skip */
      } else if (recType === 0x0ff0 && verInst >>> 4 !== 0) {
        /* skip */
      } else {
        this.walk(body);
      }
    } else {
      this.atom(recType, body);
    }
  }

  chargeRecord(): void {
    this.records += 1;
  }

  atom(recType: number, body: Uint8Array): void {
    switch (recType) {
      case 0x0f9f: {
        // TextHeaderAtom: a new text shape begins.
        this.flushShape();
        this.pending = {
          txType: body[0] ?? 1,
          text: '',
          styles: undefined,
        };
        break;
      }
      case 0x0fa0: {
        // TextCharsAtom: UTF-16LE.
        this.pushText(decodeUtf16Le(body));
        break;
      }
      case 0x0fa8: {
        // TextBytesAtom: low bytes of UTF-16 code units.
        this.pushText(decodeBytesAtom(body));
        break;
      }
      case 0x0fa1: {
        // StyleTextPropAtom: styling for the pending shape's text.
        if (this.pending !== undefined) {
          this.pending.styles = parseStyleText(body, this.pending.text.length);
        }
        break;
      }
      case 0x0fd3: {
        // ExHyperlinkAtom: explicit degradation — hyperlink targets in
        // the legacy record stream are not resolved to link inlines.
        debug('ppt hyperlink records present; targets are not resolved');
        break;
      }
      default:
        break;
    }
  }

  pushText(text: string): void {
    if (this.pending !== undefined) {
      this.pending.text += text;
    } else {
      this.pending = { txType: 1, text, styles: undefined };
    }
  }

  /**
   * Emit the pending shape: paragraphs split on CR, styled by the
   * character runs, listed by paragraph depth/bullet with master defaults.
   */
  flushShape(): void {
    const shape = this.pending;
    this.pending = undefined;
    if (shape === undefined || shape.text.length === 0) return;
    this.shapeCounter += 1;
    const shapeId = this.shapeCounter;
    const isTitle = shape.txType === 0 || shape.txType === 6;
    const styles = shape.styles ?? emptyStyleRuns();
    // The active master's per-level defaults for this text type; local
    // exceptions are tri-state and resolve over these.
    const masterLevels = this.masters[this.activeMaster]?.[1].get(shape.txType) ?? [];
    const levelDefault = (depth: number): MasterLevel => masterLevels[depth] ?? emptyMasterLevel();

    // Cursors over the style runs, counted in UTF-16 units.
    let charI = 0;
    let charRun: CharProps | undefined = styles.chars[0];
    let charLeft = charRun?.count ?? Number.MAX_SAFE_INTEGER;
    let paraI = 0;
    let paraRun: ParaProps | undefined = styles.paragraphs[0];
    let paraLeft = paraRun?.count ?? Number.MAX_SAFE_INTEGER;

    const paragraphs: Array<[Inline[], number, boolean | undefined]> = [];
    let inlines: Inline[] = [];
    let runText = '';
    let runStyle: Style = { ...PLAIN };
    const paraProps = (r: ParaProps | undefined): [number, boolean | undefined] =>
      r !== undefined ? [r.depth, r.bullet] : [0, undefined];

    for (const c of shape.text) {
      const d = levelDefault(paraProps(paraRun)[0]);
      const style: Style = {
        bold: charRun?.bold ?? d.bold ?? false,
        italic: charRun?.italic ?? d.italic ?? false,
        strike: false,
        code: false,
      };
      if (c === '\r') {
        if (runText.length > 0) {
          const text = cleanText(runText);
          runText = '';
          if (text.length > 0) inlines.push({ type: 'text', text, style: { ...runStyle } });
        }
        const [depth, bullet] = paraProps(paraRun);
        paragraphs.push([inlines, depth, bullet]);
        inlines = [];
      } else if (c === '\u{b}') {
        if (runText.length > 0) {
          const text = cleanText(runText);
          runText = '';
          if (text.length > 0) inlines.push({ type: 'text', text, style: { ...runStyle } });
        }
        inlines.push({ type: 'lineBreak' });
      } else {
        if (!stylesEqual(style, runStyle) && runText.length > 0) {
          const text = cleanText(runText);
          runText = '';
          if (text.length > 0) inlines.push({ type: 'text', text, style: { ...runStyle } });
        }
        runStyle = style;
        runText += c;
      }
      // Advance run cursors by the character's UTF-16 width.
      const width = c.length;
      charLeft = Math.max(0, charLeft - width);
      if (charLeft === 0) {
        charI += 1;
        charRun = styles.chars[charI];
        charLeft = charRun?.count ?? Number.MAX_SAFE_INTEGER;
      }
      paraLeft = Math.max(0, paraLeft - width);
      if (paraLeft === 0) {
        paraI += 1;
        paraRun = styles.paragraphs[paraI];
        paraLeft = paraRun?.count ?? Number.MAX_SAFE_INTEGER;
      }
    }
    if (runText.length > 0) {
      const text = cleanText(runText);
      if (text.length > 0) inlines.push({ type: 'text', text, style: { ...runStyle } });
    }
    if (inlines.length > 0) {
      const [depth, bullet] = paraProps(paraRun);
      paragraphs.push([inlines, depth, bullet]);
    }

    for (const [paraInlines, depth, bulletFlag] of paragraphs) {
      if (inlinesAreEmpty(paraInlines)) {
        flushList(this.current, this.listRun);
        continue;
      }
      if (isTitle) {
        flushList(this.current, this.listRun);
        const d = levelDefault(depth);
        const base: StyleDelta = {
          bold: d.bold,
          italic: d.italic,
          strike: undefined,
          code: undefined,
        };
        rebaseEmphasis(paraInlines, resolveDelta(base));
        const anchor = inlinesToPlainText(paraInlines);
        this.current.push({ type: 'heading', level: 2, anchor, content: paraInlines });
        continue;
      }
      const bullet = bulletFlag ?? levelDefault(depth).bullet ?? false;
      if (bullet) {
        this.listRun.push({
          level: depth,
          key: { instance: shapeId, marker: 'bullet' },
          number: 0,
          label: undefined,
          blocks: [{ type: 'paragraph', inlines: paraInlines }],
        });
      } else {
        flushList(this.current, this.listRun);
        this.current.push({ type: 'paragraph', inlines: paraInlines });
      }
    }
  }
}

/**
 * Resolve the UserEditAtom chain into the persist directory and find the
 * DocumentContainer's SlideListWithText instances. `undefined` means the
 * persist directory is unusable and the caller falls back to raw-order recovery.
 */
function locateDocument(data: Uint8Array, currentUser: Uint8Array): DocLayout | undefined {
  const persist = new Map<number, number>();
  let docPersist: number | undefined;
  const startEdit = getU32(currentUser, 16);
  if (startEdit === undefined) return undefined;
  let editOff = startEdit;
  for (let i = 0; i < 100; i += 1) {
    if (editOff === 0) break;
    const rec = recordAt(data, editOff);
    if (rec === undefined) return undefined;
    const recType = rec[1];
    const body = rec[2];
    if (recType !== 0x0ff5) return undefined;
    if (docPersist === undefined) docPersist = getU32(body, 16);
    const dirOff = getU32(body, 12);
    if (dirOff === undefined) return undefined;
    const dirRec = recordAt(data, dirOff);
    if (dirRec !== undefined && dirRec[1] === 0x1772) {
      const dir = dirRec[2];
      let pos = 0;
      while (pos + 4 <= dir.length) {
        const head = getU32(dir, pos);
        if (head === undefined) return undefined;
        const id = head & 0xf_ffff;
        const count = head >>> 20;
        pos += 4;
        for (let k = 0; k < count; k += 1) {
          // Newer edits win: keep the first offset seen.
          const off = getU32(dir, pos);
          if (off === undefined) return undefined;
          const key = (id + k) >>> 0;
          if (!persist.has(key)) persist.set(key, off);
          pos += 4;
        }
      }
    }
    const prev = getU32(body, 8);
    if (prev === undefined) return undefined;
    if (prev === editOff) break;
    editOff = prev;
  }

  if (docPersist === undefined) return undefined;
  const docOff = persist.get(docPersist);
  if (docOff === undefined) return undefined;
  const docRec = recordAt(data, docOff);
  if (docRec === undefined || docRec[1] !== 0x03e8) return undefined;
  const doc = docRec[2];
  let slideList: Uint8Array | undefined;
  let notesList: Uint8Array | undefined;
  let masterList: Uint8Array | undefined;
  for (const [verInst, recType, body] of children(doc)) {
    if (recType !== 0x0ff0) continue;
    const instance = verInst >>> 4;
    if (instance === 0 && slideList === undefined) slideList = body;
    else if (instance === 2 && notesList === undefined) notesList = body;
    else if (instance === 1 && masterList === undefined) masterList = body;
  }
  if (slideList === undefined) return undefined;
  return { persist, slideList, notesList, masterList };
}

/** One master's TxMasterStyleAtoms, keyed by text-type instance. */
function masterStyles(master: Uint8Array): MasterStyles {
  const styles: MasterStyles = new Map();
  for (const [verInst, recType, body] of children(master)) {
    if (recType === 0x0fa3) {
      const instance = verInst >>> 4;
      if (!styles.has(instance)) styles.set(instance, parseMasterStyle(body, instance));
    }
  }
  return styles;
}

/**
 * Masters in master-list order (MasterPersistAtoms: persistIdRef at 0,
 * masterId at 12); falls back to a persist-directory scan when the list is
 * absent so single-master decks still get their defaults.
 */
function collectMasters(
  masterList: Uint8Array | undefined,
  persist: Map<number, number>,
  data: Uint8Array,
): Array<[number, MasterStyles]> {
  const out: Array<[number, MasterStyles]> = [];
  if (masterList !== undefined) {
    for (const [, recType, body] of children(masterList)) {
      if (recType !== 0x03f3) continue;
      const persistRef = getU32(body, 0);
      const masterId = getU32(body, 12);
      if (persistRef === undefined || masterId === undefined) continue;
      const off = persist.get(persistRef);
      if (off === undefined) continue;
      const rec = recordAt(data, off);
      if (rec !== undefined && rec[1] === 0x03f8) {
        out.push([masterId, masterStyles(rec[2])]);
      }
    }
  }
  if (out.length === 0) {
    const offs = [...persist.values()].sort((a, b) => a - b);
    for (const off of offs) {
      const rec = recordAt(data, off);
      if (rec !== undefined && rec[1] === 0x03f8) {
        out.push([0, masterStyles(rec[2])]);
      }
    }
  }
  return out;
}
