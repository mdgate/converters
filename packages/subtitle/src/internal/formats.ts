import { type Document, heading, type Inline, PLAIN, plain } from '@mdgate/document';
import { cleanText, collapseWs, trim } from '@mdgate/utils';

const ITALIC = { bold: false, italic: true, strike: false, code: false } as const;
const LRC_ID = /^\s*\[[A-Za-z][^:\]]*:[^\]]*\]\s*$/;
const LRC_CUE = /^\s*\[(-?\d{1,3}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\](.*)$/;
const MICRO_LINE = /^\s*\{(-?\d+)\}\{(\d*)\}(.*)$/;
const MPL2_LINE = /^\s*\[(-?\d+)\]\[(\d*)\](.*)$/;
const MICRO_TAG = /\{[^}]*\}/g;
const SBV_TIMING =
  /^\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*,\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})\s*$/;
const JACO_CLOCK =
  /^\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,2})\b(.*)$/;
const JACO_AT = /^\s*@(\d+)\s+@(\d+)\b(.*)$/;
const JACO_FLAGS = /^(?:[jJvV][cCmMtTbBlLrR]|[jJvV][lLrR]\d+|[nNcC][cC]|[pP]\d+)\s+/;
const JACO_COMMENT = /\{[^}]*\}/g;
const JACO_CODE = /\\[BIUN]/g;
const TTML_P = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
const TTML_BEGIN = /\bbegin\s*=\s*["']([^"']+)["']/i;
const TTML_TITLE = /<(?:[\w.]+:)?title\b[^>]*>([\s\S]*?)<\/(?:[\w.]+:)?title>/i;
const KARAOKE = /<\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?>/g;
const LRC_STAMP = /^\[(-?\d{1,3}:\d{2}(?::\d{2})?(?:[.,]\d{1,3})?)\]/;
const ENTITY = /&(?:amp|lt|gt|quot|apos|nbsp|lrm|rlm|#\d+|#x[\da-f]+);/gi;

export function isLrcDocument(rows: readonly string[]): boolean {
  for (const row of rows) {
    const t = trim(row);
    if (t.length === 0) continue;
    if (LRC_ID.test(t) || LRC_CUE.test(t)) return true;
    return false;
  }
  return false;
}

export function isMicrodvdDocument(rows: readonly string[]): boolean {
  for (const row of rows) {
    const t = trim(row);
    if (t.length === 0) continue;
    return MICRO_LINE.test(t);
  }
  return false;
}

export function isMpl2Document(rows: readonly string[]): boolean {
  for (const row of rows) {
    const t = trim(row);
    if (t.length === 0) continue;
    return MPL2_LINE.test(t);
  }
  return false;
}

export function isJacosubDocument(rows: readonly string[]): boolean {
  for (const row of rows) {
    const t = trim(row);
    if (t.length === 0 || t.startsWith('#')) continue;
    return JACO_CLOCK.test(t) || JACO_AT.test(t);
  }
  return false;
}

export function isTtmlDocument(text: string): boolean {
  const head = text.slice(0, 4096);
  if (!/<tt\b/i.test(head)) return false;
  return /ttml/i.test(head) || /<tt\b[^>]*xmlns/i.test(head) || /<p\b[^>]*\bbegin=/i.test(head);
}

export function parseLrc(rows: readonly string[], doc: Document): void {
  for (const row of rows) {
    const t = trim(row);
    if (t.length === 0 || LRC_ID.test(t)) continue;
    const stamps: string[] = [];
    let i = 0;
    while (i < t.length) {
      const m = LRC_STAMP.exec(t.slice(i));
      if (m === null) break;
      stamps.push(m[1]!);
      i += m[0].length;
    }
    if (stamps.length === 0) continue;
    const cue = cleanLine(t.slice(i).replace(KARAOKE, ''));
    if (cue.length === 0) continue;
    for (const raw of stamps) {
      const start = lrcStamp(raw);
      if (start !== undefined) pushCue(doc, start, cue);
    }
  }
}

export function parseMpl2(rows: readonly string[], doc: Document): void {
  for (const row of rows) {
    const m = MPL2_LINE.exec(row);
    if (m === null) continue;
    const start = fromSeconds(Number(m[1]) / 10);
    const cue = cleanLine(
      (m[3] ?? '')
        .split('|')
        .map((part) => trim(part).replace(/^[\\/_]+/, ''))
        .join(' '),
    );
    if (start === undefined || cue.length === 0) continue;
    pushCue(doc, start, cue);
  }
}

export function parseMicrodvd(rows: readonly string[], doc: Document): void {
  let fps = 25;
  for (const row of rows) {
    const m = MICRO_LINE.exec(row);
    if (m === null) continue;
    const startFrame = Number(m[1]);
    const rest = m[3] ?? '';
    const fpsMatch = /^\s*(\d+(?:\.\d+)?)\s*fps\s*$/i.exec(rest);
    if (fpsMatch !== null) {
      const n = Number(fpsMatch[1]);
      if (Number.isFinite(n) && n > 0) fps = n;
      continue;
    }
    const cue = cleanLine(rest.replace(MICRO_TAG, '').replace(/\|/g, ' '));
    const start = fromSeconds(startFrame / fps);
    if (start === undefined || !Number.isFinite(startFrame) || startFrame < 0 || cue.length === 0) {
      continue;
    }
    pushCue(doc, start, cue);
  }
}

export function parseJacosub(rows: readonly string[], doc: Document): void {
  let ticks = 100;
  let pending: string | undefined;
  for (const raw of rows) {
    const row = pending !== undefined ? pending + raw.replace(/^\s+/, '') : raw;
    pending = undefined;
    const t = trim(row);
    if (t.length === 0) continue;
    if (t.startsWith('#')) {
      const res = /^#\s*timeres\s+(\d+)/i.exec(t);
      if (res !== null) {
        const n = Number(res[1]);
        if (Number.isFinite(n) && n > 0) ticks = n;
      }
      continue;
    }
    if (/\\\s*$/.test(row)) {
      pending = row.replace(/\\\s*$/, '');
      continue;
    }
    const clock = JACO_CLOCK.exec(row);
    if (clock !== null) {
      const start = hms(
        Number(clock[1]),
        Number(clock[2]),
        Number(clock[3]),
        Number(clock[4]) * 10,
      );
      const cue = jacoText(clock[9] ?? '');
      if (start !== undefined && cue.length > 0) pushCue(doc, start, cue);
      continue;
    }
    const at = JACO_AT.exec(row);
    if (at === null) continue;
    const start = fromSeconds(Number(at[1]) / ticks);
    const cue = jacoText(at[3] ?? '');
    if (start !== undefined && cue.length > 0) pushCue(doc, start, cue);
  }
}

export function parseTtml(text: string, doc: Document): void {
  const title = TTML_TITLE.exec(text);
  if (title !== null) {
    const name = cleanLine(title[1]!.replace(/<[^>]+>/g, ''));
    if (name.length > 0) doc.blocks.push(heading(1, [plain(name)]));
  }
  TTML_P.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TTML_P.exec(text)) !== null) {
    const begin = TTML_BEGIN.exec(m[1] ?? '');
    if (begin === null) continue;
    const start = ttmlStamp(begin[1]!);
    const cue = cleanLine(m[2]!.replace(/<br\s*\/?>/gi, ' '));
    if (start === undefined || cue.length === 0) continue;
    pushCue(doc, start, cue);
  }
}

export function parseSbvStart(line: string): string | undefined {
  const m = SBV_TIMING.exec(line);
  if (m === null) return undefined;
  return hms(Number(m[1]), Number(m[2]), Number(m[3]), fracMs(m[4]!));
}

function jacoText(raw: string): string {
  const withoutFlags = trim(raw).replace(JACO_FLAGS, '');
  return cleanLine(
    withoutFlags.replace(JACO_COMMENT, '').replace(/\\n/gi, ' ').replace(JACO_CODE, ''),
  );
}

function lrcStamp(raw: string): string | undefined {
  const parts = raw.replace(',', '.').replace(/^-/, '').split(':');
  if (parts.length === 2) {
    const min = Number(parts[0]);
    const sec = Number(parts[1]);
    if (!Number.isFinite(min + sec)) return undefined;
    return fromSeconds(min * 60 + sec);
  }
  if (parts.length === 3) {
    return hms(Number(parts[0]), Number(parts[1]), Number(parts[2]), undefined);
  }
  return undefined;
}

function ttmlStamp(raw: string): string | undefined {
  const t = trim(raw).replace(',', '.');
  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/.exec(t);
  if (clock !== null) {
    const hours = clock[1] !== undefined ? Number(clock[1]) : 0;
    const minutes = Number(clock[2]);
    const sec = Number(clock[3]);
    if (!Number.isFinite(hours + minutes + sec)) return undefined;
    return fromSeconds(hours * 3600 + minutes * 60 + sec);
  }
  const offset = /^(\d+(?:\.\d+)?)s$/i.exec(t);
  if (offset !== null) return fromSeconds(Number(offset[1]));
  return undefined;
}

function hms(
  hours: number,
  minutes: number,
  seconds: number,
  ms: number | undefined,
): string | undefined {
  const whole = Number.isFinite(seconds) && seconds >= 60 ? NaN : seconds;
  const millis = ms === undefined ? Math.round((seconds % 1) * 1000) : ms;
  const sec = ms === undefined ? Math.floor(seconds) : whole;
  if (!Number.isFinite(hours + minutes + sec + millis)) return undefined;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(sec, 2)}.${pad(millis, 3)}`;
}

function fromSeconds(total: number): string | undefined {
  if (!Number.isFinite(total) || total < 0) return undefined;
  const ms = Math.round(total * 1000);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)}.${pad(ms % 1000, 3)}`;
}

function fracMs(raw: string): number {
  if (raw.length === 1) return Number(raw) * 100;
  if (raw.length === 2) return Number(raw) * 10;
  return Number(raw.slice(0, 3));
}

function pushCue(doc: Document, start: string, text: string): void {
  doc.blocks.push({ type: 'paragraph', inlines: cueInlines(start, text) });
}

function cueInlines(start: string, text: string): Inline[] {
  return [
    { type: 'text', text: `[${start}]`, style: ITALIC },
    { type: 'text', text: ` ${text}`, style: PLAIN },
  ];
}

function cleanLine(raw: string): string {
  return trim(collapseWs(cleanText(decodeEntities(raw.replace(/<[^>]+>/g, '')))));
}

export function decodeEntities(text: string): string {
  return text.replace(ENTITY, (entity) => {
    const lower = entity.toLowerCase();
    switch (lower) {
      case '&amp;':
        return '&';
      case '&lt;':
        return '<';
      case '&gt;':
        return '>';
      case '&quot;':
        return '"';
      case '&apos;':
        return "'";
      case '&nbsp;':
        return ' ';
      case '&lrm;':
      case '&rlm;':
        return '';
      default:
        break;
    }
    if (lower.startsWith('&#x')) {
      const n = Number.parseInt(lower.slice(3, -1), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : '';
    }
    if (lower.startsWith('&#')) {
      const n = Number.parseInt(lower.slice(2, -1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : '';
    }
    return '';
  });
}

function pad(n: number, width: number): string {
  return n.toString().padStart(width, '0');
}
