import { type Inline, inlinesAreEmpty, type LinkTarget } from '@mdgate/document';
import { isAbsoluteUri, isWhitespace } from '@mdgate/utils';

/** Field accumulator: instruction text before the separator, result after. */
export interface FieldFrame {
  instr: string;
  inResult: boolean;
  inlines: Inline[];
}

export function emptyFieldFrame(): FieldFrame {
  return { instr: '', inResult: false, inlines: [] };
}

/** Finish a field: wrap the result in a link when the instruction is a hyperlink. */
export function fieldResult(instr: string, content: Inline[]): Inline[] {
  const target = hyperlinkTarget(instr);
  if (target !== undefined && !inlinesAreEmpty(content)) {
    return [{ type: 'link', content, target }];
  }
  return content;
}

type Token = { type: 'word'; word: string } | { type: 'switch'; ch: string };

function tokenize(instr: string): Token[] {
  const out: Token[] = [];
  const chars = [...instr];
  let i = 0;
  while (i < chars.length) {
    const c = chars[i]!;
    if (isWhitespace(c)) {
      i += 1;
    } else if (c === '"') {
      i += 1;
      let word = '';
      while (i < chars.length) {
        const ch = chars[i]!;
        i += 1;
        if (ch === '"') break;
        if (ch === '\\') {
          const esc = chars[i];
          if (esc === '"' || esc === '\\') {
            word += esc;
            i += 1;
          } else if (esc === undefined) {
            break;
          } else {
            word += '\\';
            word += esc;
            i += 1;
          }
        } else {
          word += ch;
        }
      }
      out.push({ type: 'word', word });
    } else if (c === '\\') {
      i += 1;
      const sw = chars[i];
      if (sw !== undefined) {
        i += 1;
        out.push({ type: 'switch', ch: sw.toLowerCase() });
      }
    } else {
      let word = '';
      while (i < chars.length) {
        const ch = chars[i]!;
        if (isWhitespace(ch)) break;
        word += ch;
        i += 1;
      }
      out.push({ type: 'word', word });
    }
  }
  return out;
}

function hyperlinkSwitchTakesArg(sw: string): boolean {
  return sw === 'l' || sw === 'o' || sw === 't';
}

/** Interpret a HYPERLINK field instruction as a link target. */
export function hyperlinkTarget(instr: string): LinkTarget | undefined {
  const tokens = tokenize(instr);
  let i = 0;
  const first = tokens[i];
  i += 1;
  if (first === undefined || first.type !== 'word' || first.word.toLowerCase() !== 'hyperlink') {
    return undefined;
  }
  let url: string | undefined;
  let anchor: string | undefined;
  while (i < tokens.length) {
    const token = tokens[i]!;
    i += 1;
    if (token.type === 'word') {
      if (url === undefined && token.word.trim().length > 0) {
        url = token.word.trim();
      }
    } else {
      let arg: string | undefined;
      if (hyperlinkSwitchTakesArg(token.ch) && tokens[i]?.type === 'word') {
        const w = tokens[i]!;
        i += 1;
        if (w.type === 'word') arg = w.word;
      }
      if (token.ch === 'l' && arg !== undefined && arg.trim().length > 0) {
        anchor = arg.trim();
      }
    }
  }
  if (url !== undefined && anchor !== undefined) return classify(`${url}#${anchor}`);
  if (url !== undefined) return classify(url);
  if (anchor !== undefined) return { type: 'anchor', id: anchor };
  return undefined;
}

/** Classify an OPC relationship target as a link target. */
export function classifyRelTarget(external: boolean, target: string): LinkTarget {
  return external ? classify(target) : { type: 'relative', url: target };
}

function classify(url: string): LinkTarget {
  if (url.startsWith('#')) return { type: 'anchor', id: url.slice(1) };
  if (isAbsoluteUri(url)) return { type: 'external', url };
  return { type: 'relative', url };
}
