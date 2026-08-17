import {
  isAlphanumeric,
  isAsciiAlphabetic,
  isAsciiDigit,
  isControl,
  isWhitespace,
} from '@mdgate/utils';

/** Where an inline run is being rendered; controls which characters can be syntax there. */
export type InlineContext = 'block' | 'heading' | 'tableCell';

/** Fine-grained escaping context beyond InlineContext. */
export interface EscapeOpts {
  /** The run begins at the start of an output line. */
  atLineStart: boolean;
  /** The run is wrapped in emphasis delimiters. */
  styled: boolean;
  /** The character following the run is unknown or active markup. */
  trailingActive: boolean;
  /** Inside a link label / image alt. */
  inLabel: boolean;
}

export const DEFAULT_ESCAPE_OPTS: EscapeOpts = {
  atLineStart: false,
  styled: false,
  trailingActive: false,
  inLabel: false,
};

export function escapeOpts(partial: Partial<EscapeOpts> = {}): EscapeOpts {
  return { ...DEFAULT_ESCAPE_OPTS, ...partial };
}

/** Escape Markdown syntax in document text. */
export function escapeText(text: string, ctx: InlineContext, opts: EscapeOpts): string {
  const { atLineStart, styled, trailingActive, inLabel } = opts;
  const chars = [...text];
  const last: Array<number | undefined> = [undefined, undefined, undefined, undefined, undefined];
  for (let j = 0; j < chars.length; j += 1) {
    switch (chars[j]) {
      case '*':
        last[0] = j;
        break;
      case '_':
        last[1] = j;
        break;
      case '~':
        last[2] = j;
        break;
      case '`':
        last[3] = j;
        break;
      case ']':
        last[4] = j;
        break;
      default:
        break;
    }
  }
  let out = '';
  let lineHasContent = !(atLineStart && ctx === 'block');
  let i = 0;
  while (i < chars.length) {
    const c = chars[i]!;
    if (c === '\n') {
      out += '\n';
      if (ctx === 'block') lineHasContent = false;
      i += 1;
      continue;
    }
    const startOfLine = !lineHasContent;
    if (!isWhitespace(c)) lineHasContent = true;
    const next = i + 1 < chars.length ? chars[i + 1] : undefined;
    const nextNonspace = next === undefined ? trailingActive : !isWhitespace(next);
    const paired = (slot: number): boolean => {
      const j = last[slot];
      return trailingActive || (j !== undefined && j > i);
    };
    let shouldEscape = false;
    switch (c) {
      case '\\':
        shouldEscape = true;
        break;
      case ']':
        shouldEscape = inLabel;
        break;
      case '`':
        shouldEscape = styled || paired(3);
        break;
      case '*':
        shouldEscape = styled || startOfLine || (nextNonspace && paired(0));
        break;
      case '_': {
        const prevAlnum = i > 0 && isAlphanumeric(chars[i - 1]!);
        const nextAlnum = next !== undefined && isAlphanumeric(next);
        shouldEscape = styled || (nextNonspace && !(prevAlnum && nextAlnum) && paired(1));
        break;
      }
      case '~':
        shouldEscape = styled || (nextNonspace && paired(2));
        break;
      case '[':
        shouldEscape = inLabel || paired(4);
        break;
      case '<':
        shouldEscape =
          next !== undefined &&
          (isAsciiAlphabetic(next) || next === '/' || next === '!' || next === '?');
        break;
      case '!':
        shouldEscape = next === undefined && trailingActive;
        break;
      case '|':
        shouldEscape = ctx === 'tableCell';
        break;
      case '&':
        if (entityAhead(chars, i)) {
          out += '&amp;';
          i += 1;
          continue;
        }
        break;
      case '#':
        if (startOfLine) {
          let j = i;
          while (j < chars.length && chars[j] === '#') j += 1;
          const n = j < chars.length ? chars[j] : undefined;
          shouldEscape = n === undefined || isWhitespace(n);
        }
        break;
      case '-':
        if (startOfLine) shouldEscape = !nextNonspace || lineIsOnly(chars, i, '-');
        break;
      case '+':
        if (startOfLine) shouldEscape = !nextNonspace;
        break;
      case '>':
        if (startOfLine) shouldEscape = true;
        break;
      case '=':
        if (startOfLine) shouldEscape = lineIsOnly(chars, i, '=');
        break;
      default:
        if (startOfLine && isAsciiDigit(c)) {
          let j = i;
          while (j < chars.length && isAsciiDigit(chars[j]!)) j += 1;
          if (
            j < chars.length &&
            (chars[j] === '.' || chars[j] === ')') &&
            (j + 1 >= chars.length || isWhitespace(chars[j + 1]!))
          ) {
            out += chars.slice(i, j).join('');
            out += '\\';
            out += chars[j];
            i = j + 1;
            continue;
          }
        }
        break;
    }
    if (shouldEscape) out += '\\';
    out += c;
    i += 1;
  }
  return out;
}

/** True when the rest of the current line is just `c`, spaces, and tabs. */
function lineIsOnly(chars: readonly string[], from: number, c: string): boolean {
  for (let k = from; k < chars.length; k += 1) {
    const ch = chars[k]!;
    if (ch === '\n') break;
    if (ch !== c && ch !== ' ' && ch !== '\t') return false;
  }
  return true;
}

function entityAhead(chars: readonly string[], at: number): boolean {
  let i = at + 1;
  if (i < chars.length && chars[i] === '#') return true;
  let seen = 0;
  while (i < chars.length && /[0-9A-Za-z]/.test(chars[i]!)) {
    i += 1;
    seen += 1;
  }
  return seen > 0 && i < chars.length && chars[i] === ';';
}

/** Format a link destination, angle-bracketing when needed. */
export function formatUrl(url: string): string {
  const hex = '0123456789ABCDEF';
  let escaped = '';
  for (const c of url) {
    if (c === '<') escaped += '%3C';
    else if (c === '>') escaped += '%3E';
    else if (c === '|') escaped += '%7C';
    else if (isControl(c)) {
      const bytes = new TextEncoder().encode(c);
      for (const byte of bytes) {
        escaped += '%';
        escaped += hex[(byte >> 4) & 0x0f];
        escaped += hex[byte & 0x0f];
      }
    } else {
      escaped += c;
    }
  }
  if ([...escaped].some((c) => isWhitespace(c) || c === '(' || c === ')')) {
    return `<${escaped}>`;
  }
  return escaped;
}

export function escapeUrlAsText(url: string, ctx: InlineContext): string {
  let cleaned = '';
  for (const c of url) cleaned += isControl(c) ? ' ' : c;
  return escapeText(cleaned, ctx, escapeOpts({ trailingActive: true, inLabel: true }));
}

/** Shortest backtick fence longer than any backtick run in `text`. */
export function backtickFence(text: string, min: number): string {
  let longest = 0;
  let run = 0;
  for (const c of text) {
    if (c === '`') {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  return '`'.repeat(Math.max(longest + 1, min));
}

/**
 * Escape a source-derived composite marker label for literal use: control
 * characters collapse to spaces and Markdown syntax is neutralized so a
 * crafted label cannot alter document structure.
 */
export function escapeMarkerLabel(label: string, ctx: InlineContext): string {
  let cleaned = '';
  for (const c of label) cleaned += isControl(c) ? ' ' : c;
  return escapeText(
    cleaned,
    ctx,
    escapeOpts({
      atLineStart: ctx === 'block',
      trailingActive: true,
    }),
  );
}
