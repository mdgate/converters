import {
  type Block,
  type Cell,
  type Document,
  emptyDocument,
  heading,
  type Inline,
  inlinesAreEmpty,
  type ListItem,
  type MarkerKind,
  type Note,
  PLAIN,
  resolveHeaderRows,
  type Style,
  tableFromRows,
} from '@mdgate/document';
import { cleanText, trim } from '@mdgate/utils';

const BOLD: Style = { bold: true, italic: false, strike: false, code: false };
const ITALIC: Style = { bold: false, italic: true, strike: false, code: false };
const CODE: Style = { bold: false, italic: false, strike: false, code: true };

const SECTION_LEVEL: Record<string, number> = {
  part: 1,
  chapter: 1,
  section: 1,
  subsection: 2,
  subsubsection: 3,
  paragraph: 4,
  subparagraph: 5,
};

const DROP_CMDS = new Set([
  'documentclass',
  'usepackage',
  'RequirePackage',
  'usetikzlibrary',
  'pagestyle',
  'thispagestyle',
  'geometry',
  'hypersetup',
  'definecolor',
  'setlength',
  'addtolength',
  'settowidth',
  'settoheight',
  'vspace',
  'hspace',
  'vskip',
  'hskip',
  'label',
  'index',
  'glossary',
  'addtocontents',
  'addcontentsline',
  'setcounter',
  'addtocounter',
  'refstepcounter',
  'newcommand',
  'renewcommand',
  'providecommand',
  'newenvironment',
  'renewenvironment',
  'newtheorem',
  'def',
  'edef',
  'gdef',
  'xdef',
  'let',
  'input',
  'include',
  'includeonly',
  'cline',
  'cmidrule',
  'graphicspath',
  'captionsetup',
  'floatname',
  'bibliographystyle',
  'bibliography',
  'nocite',
]);

const DROP_BARE = new Set([
  'makeatletter',
  'makeatother',
  'noindent',
  'indent',
  'centering',
  'raggedright',
  'raggedleft',
  'raggedbottom',
  'flushbottom',
  'sloppy',
  'fussy',
  'protect',
  'leavevmode',
  'relax',
  'hline',
  'toprule',
  'midrule',
  'bottomrule',
  'newpage',
  'clearpage',
  'cleardoublepage',
  'pagebreak',
  'nopagebreak',
  'linebreak',
  'nolinebreak',
  'smallskip',
  'medskip',
  'bigskip',
  'vfill',
  'hfill',
  'tableofcontents',
  'listoffigures',
  'listoftables',
  'appendix',
  'frontmatter',
  'mainmatter',
  'backmatter',
  'maketitle',
  'today',
  'normalsize',
  'tiny',
  'scriptsize',
  'footnotesize',
  'small',
  'large',
  'Large',
  'LARGE',
  'huge',
  'Huge',
]);

const CODE_ENVS = new Set([
  'verbatim',
  'verbatim*',
  'lstlisting',
  'lstlisting*',
  'minted',
  'minted*',
  'Verbatim',
  'BVerbatim',
  'LVerbatim',
  'alltt',
]);

const MATH_ENVS = new Set([
  'equation',
  'equation*',
  'align',
  'align*',
  'alignat',
  'alignat*',
  'flalign',
  'flalign*',
  'gather',
  'gather*',
  'multline',
  'multline*',
  'displaymath',
  'eqnarray',
  'eqnarray*',
]);

const LIST_ENVS: Record<string, MarkerKind> = {
  itemize: 'bullet',
  enumerate: 'decimal',
  description: 'bullet',
};

const QUOTE_ENVS = new Set(['quote', 'quotation', 'displayquote', 'verse', 'abstract']);

const TABLE_ENVS = new Set(['tabular', 'tabular*', 'tabularx', 'longtable', 'longtable*', 'array']);

const UNWRAP_ENVS = new Set([
  'document',
  'table',
  'table*',
  'figure',
  'figure*',
  'center',
  'flushleft',
  'flushright',
  'minipage',
  'adjustbox',
  'titlepage',
  'samepage',
  'sloppypar',
  'group',
  'tiny',
  'scriptsize',
  'footnotesize',
  'small',
  'normalsize',
  'large',
  'Large',
  'LARGE',
  'huge',
  'Huge',
]);

const RAW_SKIP_ENVS = new Set(['comment', 'filecontents', 'filecontents*']);

const ACCENT: Record<string, Record<string, string>> = {
  "'": { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú' },
  '`': { a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù' },
  '^': { a: 'â', e: 'ê', i: 'î', o: 'ô', u: 'û', A: 'Â', E: 'Ê', I: 'Î', O: 'Ô', U: 'Û' },
  '"': { a: 'ä', e: 'ë', i: 'ï', o: 'ö', u: 'ü', y: 'ÿ', A: 'Ä', E: 'Ë', I: 'Ï', O: 'Ö', U: 'Ü' },
  '~': { a: 'ã', n: 'ñ', o: 'õ', A: 'Ã', N: 'Ñ', O: 'Õ' },
  c: { c: 'ç', C: 'Ç' },
  v: { s: 'š', z: 'ž', c: 'č', S: 'Š', Z: 'Ž', C: 'Č' },
};

const TEXT_MACROS: Record<string, string> = {
  LaTeX: 'LaTeX',
  TeX: 'TeX',
  ldots: '...',
  dots: '...',
  textbackslash: '\\',
  textasciitilde: '~',
  textasciicircum: '^',
  textbar: '|',
  textless: '<',
  textgreater: '>',
  sim: '~',
  S: '§',
  P: '¶',
  dag: '†',
  ddag: '‡',
  copyright: '©',
  pounds: '£',
  euro: '€',
  degree: '°',
};

interface Stop {
  atGroup?: boolean;
  atCell?: boolean;
  atRow?: boolean;
  atItem?: boolean;
  endEnv?: string;
  endDocument?: boolean;
}

type CmdResult =
  | { kind: 'inlines'; inlines: Inline[] }
  | { kind: 'blocks'; blocks: Block[] }
  | { kind: 'break' }
  | { kind: 'item' }
  | { kind: 'row' }
  | { kind: 'stop' }
  | { kind: 'empty' };

export function looksLikeLatex(bytes: Uint8Array): boolean {
  if (isPdf(bytes)) return false;
  const text = decodeHead(bytes);
  return latexSignature(text);
}

export function parse(bytes: Uint8Array): Document {
  const text = decodeText(bytes).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return new Parser(text).parse();
}

function latexSignature(text: string): boolean {
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  i = skipWs(text, i);
  if (i >= text.length) return false;
  if (text.charCodeAt(i) === 0x25) return true;
  i = skipWsAndComments(text, i);
  return isCommandAt(text, i, 'documentclass') || isBeginEnvAt(text, i, 'document');
}

function isCommandAt(text: string, i: number, name: string): boolean {
  if (text.charCodeAt(i) !== 0x5c) return false;
  const start = i + 1;
  if (!text.startsWith(name, start)) return false;
  const after = start + name.length;
  return after >= text.length || !isLetter(text.charCodeAt(after));
}

function isBeginEnvAt(text: string, i: number, env: string): boolean {
  if (!isCommandAt(text, i, 'begin')) return false;
  let j = i + 6;
  j = skipWs(text, j);
  if (text.charCodeAt(j) !== 0x7b) return false;
  j = skipWs(text, j + 1);
  if (!text.startsWith(env, j)) return false;
  j = skipWs(text, j + env.length);
  return text.charCodeAt(j) === 0x7d;
}

function skipWs(text: string, i: number): number {
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c !== 0x09 && c !== 0x0a && c !== 0x0d && c !== 0x20) break;
    i += 1;
  }
  return i;
}

function skipWsAndComments(text: string, i: number): number {
  for (;;) {
    i = skipWs(text, i);
    if (text.charCodeAt(i) !== 0x25) return i;
    const nl = text.indexOf('\n', i + 1);
    i = nl < 0 ? text.length : nl + 1;
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c !== 0x09 && c !== 0x20) break;
      i += 1;
    }
  }
}

class Src {
  i = 0;
  constructor(readonly text: string) {}

  get eof(): boolean {
    return this.i >= this.text.length;
  }

  peek(): string {
    return this.text[this.i] ?? '';
  }

  peekCode(): number {
    return this.i < this.text.length ? this.text.charCodeAt(this.i) : 0;
  }

  next(): string {
    const c = this.text[this.i] ?? '';
    this.i += 1;
    return c;
  }

  startsWith(s: string): boolean {
    return this.text.startsWith(s, this.i);
  }

  skipSpaces(): void {
    while (this.i < this.text.length) {
      const c = this.text.charCodeAt(this.i);
      if (c !== 0x09 && c !== 0x20) break;
      this.i += 1;
    }
  }

  skipWs(): void {
    this.i = skipWs(this.text, this.i);
  }

  // TeX: the newline after % is discarded, then leading spaces on the next line.
  skipComment(): void {
    const nl = this.text.indexOf('\n', this.i);
    this.i = nl < 0 ? this.text.length : nl + 1;
    this.skipSpaces();
  }

  skipWsComments(): void {
    for (;;) {
      const c = this.peekCode();
      if (c === 0x09 || c === 0x0a || c === 0x0d || c === 0x20) {
        this.i += 1;
        continue;
      }
      if (c === 0x25) {
        this.skipComment();
        continue;
      }
      return;
    }
  }

  skipSpacesComments(): void {
    for (;;) {
      const c = this.peekCode();
      if (c === 0x09 || c === 0x20) {
        this.i += 1;
        continue;
      }
      if (c === 0x25) {
        this.skipComment();
        continue;
      }
      return;
    }
  }

  take(s: string): boolean {
    if (!this.startsWith(s)) return false;
    this.i += s.length;
    return true;
  }

  readEscape(): string | undefined {
    if (this.peekCode() !== 0x5c) return undefined;
    this.i += 1;
    if (this.eof) return '';
    const first = this.text.charCodeAt(this.i);
    if (isLetter(first)) {
      const start = this.i;
      this.i += 1;
      while (this.i < this.text.length && isLetter(this.text.charCodeAt(this.i))) this.i += 1;
      const name = this.text.slice(start, this.i);
      this.skipSpaces();
      return name;
    }
    this.i += 1;
    return this.text[this.i - 1]!;
  }

  peekEscape(): string | undefined {
    const saved = this.i;
    const name = this.readEscape();
    this.i = saved;
    return name;
  }

  readGroupRaw(): string | undefined {
    this.skipSpacesComments();
    if (this.peekCode() !== 0x7b) return undefined;
    this.i += 1;
    const start = this.i;
    let depth = 1;
    while (this.i < this.text.length && depth > 0) {
      const c = this.text.charCodeAt(this.i);
      if (c === 0x5c) {
        this.i += this.i + 1 < this.text.length ? 2 : 1;
        continue;
      }
      if (c === 0x25) {
        this.skipComment();
        continue;
      }
      if (c === 0x7b) depth += 1;
      else if (c === 0x7d) depth -= 1;
      this.i += 1;
    }
    return this.text.slice(start, this.i - (depth === 0 ? 1 : 0));
  }

  skipOptional(): string | undefined {
    this.skipSpacesComments();
    if (this.peekCode() !== 0x5b) return undefined;
    this.i += 1;
    const start = this.i;
    let depth = 1;
    let braces = 0;
    while (this.i < this.text.length && depth > 0) {
      const c = this.text.charCodeAt(this.i);
      if (c === 0x5c) {
        this.i += this.i + 1 < this.text.length ? 2 : 1;
        continue;
      }
      if (c === 0x25) {
        this.skipComment();
        continue;
      }
      if (c === 0x7b) braces += 1;
      else if (c === 0x7d && braces > 0) braces -= 1;
      else if (c === 0x5b && braces === 0) depth += 1;
      else if (c === 0x5d && braces === 0) depth -= 1;
      this.i += 1;
    }
    return this.text.slice(start, this.i - (depth === 0 ? 1 : 0));
  }

  skipStar(): boolean {
    this.skipSpacesComments();
    return this.take('*');
  }

  readUntilEndEnv(env: string): string {
    const re = new RegExp(`\\\\end\\s*\\{\\s*${escapeRe(env)}\\s*\\}`);
    const rest = this.text.slice(this.i);
    const match = re.exec(rest);
    if (match === null || match.index === undefined) {
      const raw = rest;
      this.i = this.text.length;
      return stripLeadingNl(raw);
    }
    const raw = rest.slice(0, match.index);
    this.i += match.index + match[0]!.length;
    return stripLeadingNl(raw);
  }

  consumeEndEnv(env: string): boolean {
    const saved = this.i;
    this.skipWsComments();
    if (this.peekEscape() !== 'end') {
      this.i = saved;
      return false;
    }
    this.readEscape();
    const name = this.readGroupRaw();
    if (name !== undefined && trim(name) === env) return true;
    this.i = saved;
    return false;
  }

  peekEndEnv(): string | undefined {
    const saved = this.i;
    this.skipWsComments();
    if (this.peekEscape() !== 'end') {
      this.i = saved;
      return undefined;
    }
    this.readEscape();
    const name = this.readGroupRaw();
    this.i = saved;
    return name !== undefined ? trim(name) : undefined;
  }

  peekItem(): boolean {
    const saved = this.i;
    this.skipWsComments();
    const name = this.peekEscape();
    this.i = saved;
    return name === 'item';
  }
}

class Parser {
  readonly src: Src;
  style: Style = PLAIN;
  title: Inline[] | undefined;
  author: Inline[] | undefined;
  notes: Note[] = [];
  noteN = 0;
  drop = false;
  sawMaketitle = false;

  constructor(text: string) {
    this.src = new Src(text);
  }

  parse(): Document {
    this.drop = hasBeginDocument(this.src.text);
    const blocks = this.parseBlocks({ endDocument: true });
    const doc = emptyDocument();
    if (this.title !== undefined && !this.sawMaketitle) {
      doc.blocks.push(...this.titleBlocks());
    }
    doc.blocks.push(...blocks);
    doc.notes = this.notes;
    return doc;
  }

  private titleBlocks(): Block[] {
    const out: Block[] = [];
    if (this.title !== undefined && !inlinesAreEmpty(this.title)) {
      out.push(heading(1, this.title));
    }
    if (this.author !== undefined && !inlinesAreEmpty(this.author)) {
      out.push({ type: 'paragraph', inlines: flattenAuthor(this.author) });
    }
    return out;
  }

  private sectionLevel(name: string): number {
    const base = SECTION_LEVEL[name] ?? 1;
    return this.title !== undefined ? base + 1 : base;
  }

  parseBlocks(stop: Stop): Block[] {
    const blocks: Block[] = [];
    let inlines: Inline[] = [];
    const flush = (): void => {
      const cleaned = squeeze(inlines);
      if (!inlinesAreEmpty(cleaned)) blocks.push({ type: 'paragraph', inlines: cleaned });
      inlines = [];
    };

    while (!this.src.eof) {
      if (this.drop) {
        this.consumePreamble();
        continue;
      }
      if (this.shouldStop(stop)) break;

      const c = this.src.peekCode();
      if (c === 0) break;

      if (c === 0x25) {
        this.src.skipComment();
        continue;
      }

      if (c === 0x0a) {
        this.src.i += 1;
        if (this.isBlankLine()) {
          this.skipBlankLines();
          flush();
        } else {
          pushSpace(inlines, this.style);
        }
        continue;
      }

      if (c === 0x09 || c === 0x20 || c === 0x0d) {
        this.src.i += 1;
        pushSpace(inlines, this.style);
        continue;
      }

      if (c === 0x7d) {
        if (stop.atGroup) break;
        this.src.i += 1;
        continue;
      }

      if (c === 0x26) {
        if (stop.atCell) break;
        this.src.i += 1;
        inlines.push(styled('&', this.style));
        continue;
      }

      if (c === 0x7b) {
        inlines.push(...this.parseGroupInlines());
        continue;
      }

      if (c === 0x24) {
        const math = this.parseDollar();
        if (math.kind === 'blocks') {
          flush();
          blocks.push(...math.blocks);
        } else if (math.kind === 'inlines') {
          inlines.push(...math.inlines);
        }
        continue;
      }

      if (c === 0x5c) {
        const result = this.parseCommand(stop);
        if (result.kind === 'stop') break;
        if (result.kind === 'item') break;
        if (result.kind === 'row') break;
        if (result.kind === 'break') {
          flush();
          continue;
        }
        if (result.kind === 'blocks') {
          flush();
          blocks.push(...result.blocks);
          continue;
        }
        if (result.kind === 'inlines') {
          inlines.push(...result.inlines);
          continue;
        }
        continue;
      }

      if (c === 0x7e) {
        this.src.i += 1;
        pushSpace(inlines, this.style);
        continue;
      }

      if (c === 0x60 && this.src.startsWith('``')) {
        this.src.i += 2;
        inlines.push(styled('\u201c', this.style));
        continue;
      }
      if (c === 0x27 && this.src.startsWith("''")) {
        this.src.i += 2;
        inlines.push(styled('\u201d', this.style));
        continue;
      }
      if (c === 0x2d && this.src.startsWith('---')) {
        this.src.i += 3;
        inlines.push(styled('\u2014', this.style));
        continue;
      }
      if (c === 0x2d && this.src.startsWith('--')) {
        this.src.i += 2;
        inlines.push(styled('\u2013', this.style));
        continue;
      }

      inlines.push(styled(this.src.next(), this.style));
    }

    flush();
    return blocks;
  }

  private parseCommand(stop: Stop): CmdResult {
    const name = this.src.readEscape();
    if (name === undefined) return { kind: 'empty' };
    this.src.skipStar();

    if (name === 'begin') return this.parseBegin();
    if (name === 'end') return this.parseEnd(stop);
    if (name === 'item') return { kind: 'item' };
    if (name === 'par') return { kind: 'break' };
    if (name === '\\') {
      this.src.skipOptional();
      if (stop.atRow) return { kind: 'row' };
      return { kind: 'inlines', inlines: [{ type: 'lineBreak' }] };
    }
    if (name === 'newline') return { kind: 'inlines', inlines: [{ type: 'lineBreak' }] };

    if (name === '[') {
      const raw = this.readUntilCmd(']');
      return { kind: 'blocks', blocks: displayMath(raw) };
    }
    if (name === '(') {
      const raw = this.readUntilCmd(')');
      return { kind: 'inlines', inlines: [plainKeep(`$${trim(raw)}$`)] };
    }
    if (name === ']') return { kind: 'empty' };
    if (name === ')') return { kind: 'empty' };

    if (name === 'maketitle') {
      this.sawMaketitle = true;
      return { kind: 'blocks', blocks: this.titleBlocks() };
    }

    if (name === 'title') {
      this.title = this.parseArgInlines();
      return { kind: 'empty' };
    }
    if (name === 'author') {
      this.author = this.parseArgInlines();
      return { kind: 'empty' };
    }
    if (name === 'date') {
      this.parseArgInlines();
      return { kind: 'empty' };
    }
    if (name === 'and') return { kind: 'inlines', inlines: [styled(', ', this.style)] };
    if (name === 'thanks') {
      this.skipArg();
      return { kind: 'empty' };
    }

    if (name in SECTION_LEVEL) {
      this.src.skipOptional();
      const content = this.parseArgInlines();
      const level = this.sectionLevel(name);
      if (inlinesAreEmpty(content)) return { kind: 'empty' };
      return { kind: 'blocks', blocks: [heading(level, content)] };
    }

    if (name === 'caption') {
      this.src.skipOptional();
      const content = this.parseArgInlines();
      if (inlinesAreEmpty(content)) return { kind: 'empty' };
      return {
        kind: 'blocks',
        blocks: [{ type: 'paragraph', inlines: styleInlines(content, ITALIC) }],
      };
    }

    if (name === 'textbf' || name === 'mathbf') {
      return { kind: 'inlines', inlines: styleInlines(this.parseArgInlines(), BOLD) };
    }
    if (name === 'textit' || name === 'textsl' || name === 'emph' || name === 'mathit') {
      return { kind: 'inlines', inlines: styleInlines(this.parseArgInlines(), ITALIC) };
    }
    if (name === 'texttt' || name === 'mathtt' || name === 'textsf') {
      return { kind: 'inlines', inlines: styleInlines(this.parseArgInlines(), CODE) };
    }
    if (name === 'text' || name === 'textrm' || name === 'textmd' || name === 'underline') {
      return { kind: 'inlines', inlines: this.parseArgInlines() };
    }

    if (name === 'bf' || name === 'bfseries') {
      this.style = mergeStyle(this.style, BOLD);
      return { kind: 'empty' };
    }
    if (name === 'it' || name === 'itshape' || name === 'em' || name === 'slshape') {
      this.style = mergeStyle(this.style, ITALIC);
      return { kind: 'empty' };
    }
    if (name === 'tt' || name === 'ttfamily') {
      this.style = mergeStyle(this.style, CODE);
      return { kind: 'empty' };
    }

    if (name === 'url') {
      const url = trim(this.src.readGroupRaw() ?? '');
      if (url.length === 0) return { kind: 'empty' };
      return {
        kind: 'inlines',
        inlines: [
          { type: 'link', content: [styled(url, this.style)], target: { type: 'external', url } },
        ],
      };
    }
    if (name === 'href') {
      const url = trim(this.src.readGroupRaw() ?? '');
      const content = this.parseArgInlines();
      if (url.length === 0) return { kind: 'inlines', inlines: content };
      return {
        kind: 'inlines',
        inlines: [{ type: 'link', content, target: { type: 'external', url } }],
      };
    }
    if (name === 'includegraphics') {
      this.src.skipOptional();
      const path = trim(this.src.readGroupRaw() ?? '');
      if (path.length === 0) return { kind: 'empty' };
      return {
        kind: 'inlines',
        inlines: [{ type: 'image', alt: path, source: { type: 'external', url: path } }],
      };
    }

    if (name === 'footnote') {
      const content = this.parseArgInlines();
      this.noteN += 1;
      const id = `fn${this.noteN}`;
      this.notes.push({
        id,
        kind: 'footnote',
        blocks: [{ type: 'paragraph', inlines: content }],
      });
      return { kind: 'inlines', inlines: [{ type: 'noteRef', id }] };
    }

    if (name === 'verb' || name === 'lstinline') {
      return { kind: 'inlines', inlines: this.parseVerb(name) };
    }

    if (
      name === ' ' ||
      name === ',' ||
      name === ';' ||
      name === ':' ||
      name === 'quad' ||
      name === 'qquad'
    ) {
      return { kind: 'inlines', inlines: [styled(' ', this.style)] };
    }
    if (name === '!' || name === '/') return { kind: 'empty' };

    if (
      name === '%' ||
      name === '$' ||
      name === '&' ||
      name === '#' ||
      name === '_' ||
      name === '{' ||
      name === '}'
    ) {
      return { kind: 'inlines', inlines: [styled(name, this.style)] };
    }
    if (name === '~') return { kind: 'inlines', inlines: [styled('~', this.style)] };

    if (name in TEXT_MACROS) {
      return { kind: 'inlines', inlines: [styled(TEXT_MACROS[name]!, this.style)] };
    }

    if (name in ACCENT || name === '=') {
      const letter = this.readAccentArg();
      const mapped = ACCENT[name]?.[letter];
      return { kind: 'inlines', inlines: [styled(mapped ?? letter, this.style)] };
    }

    if (DROP_CMDS.has(name)) {
      this.skipUnknownArgs();
      return { kind: 'empty' };
    }
    if (DROP_BARE.has(name)) {
      this.src.skipOptional();
      return { kind: 'empty' };
    }

    return { kind: 'inlines', inlines: this.takeUnknownArgs() };
  }

  private parseBegin(): CmdResult {
    const env = trim(this.src.readGroupRaw() ?? '');
    if (env.length === 0) return { kind: 'empty' };

    if (env === 'document') return { kind: 'break' };

    if (CODE_ENVS.has(env)) {
      const lang = this.codeLang(env);
      const text = this.src.readUntilEndEnv(env);
      return { kind: 'blocks', blocks: [{ type: 'codeBlock', lang, text: trimEndNl(text) }] };
    }

    if (MATH_ENVS.has(env) || env === 'math') {
      const raw = trim(this.src.readUntilEndEnv(env));
      if (env === 'math') return { kind: 'inlines', inlines: [plainKeep(`$${raw}$`)] };
      return { kind: 'blocks', blocks: displayMath(raw) };
    }

    if (RAW_SKIP_ENVS.has(env)) {
      this.src.readUntilEndEnv(env);
      return { kind: 'empty' };
    }

    const marker = LIST_ENVS[env];
    if (marker !== undefined) {
      return { kind: 'blocks', blocks: [this.parseList(env, marker)] };
    }

    if (QUOTE_ENVS.has(env)) {
      const inner = this.parseBlocks({ endEnv: env, endDocument: true });
      this.src.consumeEndEnv(env);
      return {
        kind: 'blocks',
        blocks: inner.length > 0 ? [{ type: 'blockQuote', blocks: inner }] : [],
      };
    }

    if (TABLE_ENVS.has(env)) {
      return { kind: 'blocks', blocks: this.parseTabular(env) };
    }

    if (UNWRAP_ENVS.has(env) || env.length > 0) {
      this.src.skipOptional();
      if (
        this.src.peekCode() === 0x7b &&
        (env === 'minipage' || env === 'tabular*' || env === 'adjustbox')
      ) {
        this.src.readGroupRaw();
      }
      const inner = this.parseBlocks({ endEnv: env, endDocument: true });
      this.src.consumeEndEnv(env);
      return { kind: 'blocks', blocks: inner };
    }

    return { kind: 'empty' };
  }

  private parseEnd(stop: Stop): CmdResult {
    const env = trim(this.src.readGroupRaw() ?? '');
    if (env === 'document' || (stop.endEnv !== undefined && env === stop.endEnv)) {
      return { kind: 'stop' };
    }
    return { kind: 'empty' };
  }

  private preambleArg(): Inline[] {
    const was = this.drop;
    this.drop = false;
    const inlines = this.parseArgInlines();
    this.drop = was;
    return inlines;
  }

  private parseList(env: string, marker: MarkerKind): Block {
    const items: ListItem[] = [];
    while (!this.src.eof) {
      this.src.skipWsComments();
      if (this.src.eof) break;
      if (this.src.peekEndEnv() === env || this.src.peekEndEnv() === 'document') break;
      if (!this.src.peekItem()) {
        this.parseBlocks({ atItem: true, endEnv: env, endDocument: true });
        continue;
      }
      this.src.readEscape();
      this.src.skipStar();
      const label = this.src.skipOptional();
      const itemBlocks = this.parseBlocks({ atItem: true, endEnv: env, endDocument: true });
      items.push({
        blocks:
          itemBlocks.length > 0
            ? itemBlocks
            : [{ type: 'paragraph', inlines: [styled('', PLAIN)] }],
        checked: undefined,
        markerLabel: label !== undefined && env === 'description' ? trim(label) : undefined,
      });
    }
    this.src.consumeEndEnv(env);
    return { type: 'list', list: { marker, start: 1, items } };
  }

  private parseTabular(env: string): Block[] {
    this.src.skipOptional();
    this.src.readGroupRaw();
    const rows: Cell[][] = [];
    let row: Cell[] = [];
    while (!this.src.eof) {
      this.src.skipWsComments();
      if (this.src.eof) break;
      const end = this.src.peekEndEnv();
      if (end === env || end === 'document') break;

      const cellBlocks = this.parseBlocks({
        atCell: true,
        atRow: true,
        endEnv: env,
        endDocument: true,
      });
      row.push({
        blocks: cellBlocks,
        colSpan: 1,
        rowSpan: 1,
      });

      this.src.skipSpacesComments();
      if (this.src.peekCode() === 0x26) {
        this.src.i += 1;
        continue;
      }
      const cmd = this.src.peekEscape();
      if (cmd === '\\') {
        this.src.readEscape();
        this.src.skipStar();
        this.src.skipOptional();
        rows.push(row);
        row = [];
        continue;
      }
      break;
    }
    if (row.some((c) => c.blocks.length > 0)) rows.push(row);
    this.src.consumeEndEnv(env);
    if (rows.length === 0) return [];
    const table = tableFromRows(rows, 0, 'data');
    table.headerRows = resolveHeaderRows(table, 0);
    return [{ type: 'table', table }];
  }

  private parseGroupInlines(): Inline[] {
    if (this.src.peekCode() !== 0x7b) return [];
    const prev = this.style;
    this.src.i += 1;
    const blocks = this.parseBlocks({ atGroup: true });
    if (this.src.peekCode() === 0x7d) this.src.i += 1;
    this.style = prev;
    return flattenBlocks(blocks);
  }

  private parseArgInlines(): Inline[] {
    this.src.skipSpacesComments();
    if (this.src.peekCode() === 0x7b) return this.parseGroupInlines();
    return this.parseOneAtom();
  }

  private parseOneAtom(): Inline[] {
    if (this.src.eof) return [];
    const c = this.src.peekCode();
    if (c === 0x5c) {
      const result = this.parseCommand({});
      if (result.kind === 'inlines') return result.inlines;
      return [];
    }
    if (c === 0x7b) return this.parseGroupInlines();
    return [styled(this.src.next(), this.style)];
  }

  private skipArg(): void {
    this.src.skipSpacesComments();
    if (this.src.peekCode() === 0x7b) this.src.readGroupRaw();
    else if (!this.src.eof) this.src.i += 1;
  }

  private skipUnknownArgs(): void {
    for (;;) {
      const opt = this.src.skipOptional();
      if (opt !== undefined) continue;
      this.src.skipSpacesComments();
      if (this.src.peekCode() === 0x7b) {
        this.src.readGroupRaw();
        continue;
      }
      return;
    }
  }

  private takeUnknownArgs(): Inline[] {
    const out: Inline[] = [];
    for (;;) {
      const opt = this.src.skipOptional();
      if (opt !== undefined) continue;
      this.src.skipSpacesComments();
      if (this.src.peekCode() === 0x7b) {
        out.push(...this.parseGroupInlines());
        continue;
      }
      return out;
    }
  }

  private parseVerb(name: string): Inline[] {
    if (name === 'lstinline') this.src.skipOptional();
    if (this.src.peekCode() === 0x7b) {
      const raw = this.src.readGroupRaw() ?? '';
      return [styled(raw, CODE)];
    }
    if (this.src.eof) return [];
    const delim = this.src.next();
    const start = this.src.i;
    const end = this.src.text.indexOf(delim, start);
    if (end < 0) {
      const raw = this.src.text.slice(start);
      this.src.i = this.src.text.length;
      return [styled(raw, CODE)];
    }
    const raw = this.src.text.slice(start, end);
    this.src.i = end + 1;
    return [styled(raw, CODE)];
  }

  private parseDollar(): CmdResult {
    this.src.i += 1;
    if (this.src.peekCode() === 0x24) {
      this.src.i += 1;
      const raw = this.readUntilStr('$$');
      return { kind: 'blocks', blocks: displayMath(raw) };
    }
    const raw = this.readUntilStr('$');
    return { kind: 'inlines', inlines: [plainKeep(`$${raw}$`)] };
  }

  private readUntilStr(end: string): string {
    const start = this.src.i;
    while (!this.src.eof) {
      if (this.src.peekCode() === 0x25) {
        this.src.skipComment();
        continue;
      }
      if (this.src.startsWith(end) && this.src.text[this.src.i - 1] !== '\\') {
        const raw = this.src.text.slice(start, this.src.i);
        this.src.i += end.length;
        return raw;
      }
      this.src.i += 1;
    }
    return this.src.text.slice(start);
  }

  private readUntilCmd(name: string): string {
    const start = this.src.i;
    while (!this.src.eof) {
      if (this.src.peekCode() === 0x25) {
        this.src.skipComment();
        continue;
      }
      if (this.src.peekCode() === 0x5c && this.src.peekEscape() === name) {
        const raw = this.src.text.slice(start, this.src.i);
        this.src.readEscape();
        return raw;
      }
      this.src.i += 1;
    }
    return this.src.text.slice(start);
  }

  private readAccentArg(): string {
    this.src.skipSpacesComments();
    if (this.src.peekCode() === 0x7b) return trim(this.src.readGroupRaw() ?? '');
    if (this.src.peekCode() === 0x5c) {
      const name = this.src.readEscape() ?? '';
      return name === 'i' || name === 'imath' ? 'i' : name;
    }
    if (this.src.eof) return '';
    return this.src.next();
  }

  private codeLang(env: string): string | undefined {
    if (env === 'minted' || env === 'minted*') {
      this.src.skipOptional();
      const lang = trim(this.src.readGroupRaw() ?? '');
      return lang.length > 0 ? lang.toLowerCase() : undefined;
    }
    if (env === 'lstlisting' || env === 'lstlisting*') {
      const opt = this.src.skipOptional();
      return languageFromOpt(opt);
    }
    return undefined;
  }

  private consumePreamble(): void {
    this.src.skipWsComments();
    if (this.src.eof) {
      this.drop = false;
      return;
    }
    if (this.src.peekCode() !== 0x5c) {
      this.src.i += 1;
      return;
    }
    const name = this.src.readEscape();
    if (name === undefined) return;
    this.src.skipStar();
    if (name === 'title') {
      this.title = this.preambleArg();
      return;
    }
    if (name === 'author') {
      this.author = this.preambleArg();
      return;
    }
    if (name === 'date') {
      this.preambleArg();
      return;
    }
    if (name === 'begin') {
      const env = trim(this.src.readGroupRaw() ?? '');
      if (env === 'document') {
        this.drop = false;
        return;
      }
      this.skipEnv(env);
      return;
    }
    if (name === 'end') {
      this.src.readGroupRaw();
      return;
    }
    this.skipUnknownArgs();
  }

  private skipEnv(env: string): void {
    if (env.length === 0) return;
    if (CODE_ENVS.has(env) || RAW_SKIP_ENVS.has(env) || MATH_ENVS.has(env)) {
      this.src.readUntilEndEnv(env);
      return;
    }
    let depth = 1;
    while (!this.src.eof && depth > 0) {
      this.src.skipWsComments();
      if (this.src.eof) break;
      if (this.src.peekCode() !== 0x5c) {
        this.src.i += 1;
        continue;
      }
      const name = this.src.readEscape();
      if (name === 'begin') {
        const inner = trim(this.src.readGroupRaw() ?? '');
        if (inner === env) depth += 1;
        else if (CODE_ENVS.has(inner) || RAW_SKIP_ENVS.has(inner)) this.src.readUntilEndEnv(inner);
      } else if (name === 'end') {
        const inner = trim(this.src.readGroupRaw() ?? '');
        if (inner === env) depth -= 1;
      }
    }
  }

  private shouldStop(stop: Stop): boolean {
    const saved = this.src.i;
    this.src.skipSpacesComments();
    if (this.src.eof) {
      this.src.i = saved;
      return true;
    }
    const c = this.src.peekCode();
    if (stop.atGroup && c === 0x7d) {
      this.src.i = saved;
      return true;
    }
    if (stop.atCell && c === 0x26) {
      this.src.i = saved;
      return true;
    }
    if (c === 0x5c) {
      const name = this.src.peekEscape();
      if (stop.atItem && name === 'item') {
        this.src.i = saved;
        return true;
      }
      if (stop.atRow && name === '\\') {
        this.src.i = saved;
        return true;
      }
      if (name === 'end') {
        const env = this.src.peekEndEnv();
        if (stop.endEnv !== undefined && env === stop.endEnv) {
          this.src.i = saved;
          return true;
        }
        if (stop.endDocument && env === 'document') {
          this.src.i = saved;
          return true;
        }
      }
    }
    this.src.i = saved;
    return false;
  }

  private isBlankLine(): boolean {
    const saved = this.src.i;
    this.src.skipSpaces();
    if (this.src.peekCode() === 0x25) {
      this.src.i = saved;
      return false;
    }
    const blank = this.src.eof || this.src.peekCode() === 0x0a;
    this.src.i = saved;
    return blank;
  }

  private skipBlankLines(): void {
    for (;;) {
      const saved = this.src.i;
      this.src.skipSpaces();
      if (this.src.peekCode() === 0x0a) {
        this.src.i += 1;
        continue;
      }
      this.src.i = saved;
      return;
    }
  }
}

function hasBeginDocument(text: string): boolean {
  const src = new Src(text);
  while (!src.eof) {
    src.skipWsComments();
    if (src.eof) return false;
    if (src.peekCode() === 0x5c) {
      const name = src.readEscape();
      if (name === 'begin') {
        const env = src.readGroupRaw();
        if (env !== undefined && trim(env) === 'document') return true;
      }
      continue;
    }
    src.i += 1;
  }
  return false;
}

function displayMath(raw: string): Block[] {
  const body = trim(raw);
  if (body.length === 0) return [];
  return [{ type: 'paragraph', inlines: [plainKeep(`$$${body}$$`)] }];
}

function languageFromOpt(opt: string | undefined): string | undefined {
  if (opt === undefined) return undefined;
  const match = /language\s*=\s*\{?([A-Za-z0-9_+-]+)/i.exec(opt);
  if (match === null) return undefined;
  return match[1]!.toLowerCase();
}

function flattenBlocks(blocks: Block[]): Inline[] {
  const out: Inline[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    if (i > 0) out.push({ type: 'lineBreak' });
    if (block.type === 'paragraph') out.push(...block.inlines);
    else if (block.type === 'heading') out.push(...block.content);
    else if (block.type === 'codeBlock') out.push(styled(block.text, CODE));
  }
  return out;
}

function flattenAuthor(inlines: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const inline of inlines) {
    if (inline.type === 'lineBreak') out.push(styled(', ', PLAIN));
    else out.push(inline);
  }
  return squeeze(out);
}

function styleInlines(inlines: Inline[], over: Style): Inline[] {
  return inlines.map((inline) => {
    if (inline.type === 'text')
      return { type: 'text', text: inline.text, style: mergeStyle(inline.style, over) };
    if (inline.type === 'link') return { ...inline, content: styleInlines(inline.content, over) };
    return inline;
  });
}

function mergeStyle(base: Style, over: Style): Style {
  return {
    bold: over.bold || base.bold,
    italic: over.italic || base.italic,
    strike: over.strike || base.strike,
    code: over.code || base.code,
  };
}

function styled(text: string, style: Style): Inline {
  return { type: 'text', text: cleanText(text), style };
}

function plainKeep(text: string): Inline {
  return { type: 'text', text, style: PLAIN };
}

function pushSpace(inlines: Inline[], style: Style): void {
  const last = inlines[inlines.length - 1];
  if (last === undefined) return;
  if (last.type === 'text') {
    if (last.text.length === 0 || last.text.endsWith(' ')) return;
    last.text += ' ';
    return;
  }
  if (last.type === 'lineBreak') return;
  inlines.push(styled(' ', style));
}

function squeeze(inlines: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const inline of inlines) {
    if (inline.type === 'text' && inline.text.length === 0) continue;
    const prev = out[out.length - 1];
    if (
      prev !== undefined &&
      prev.type === 'text' &&
      inline.type === 'text' &&
      prev.style.bold === inline.style.bold &&
      prev.style.italic === inline.style.italic &&
      prev.style.strike === inline.style.strike &&
      prev.style.code === inline.style.code
    ) {
      prev.text += inline.text;
      continue;
    }
    out.push(inline);
  }
  return out;
}

function stripLeadingNl(text: string): string {
  if (text.charCodeAt(0) === 0x0a) return text.slice(1);
  return text;
}

function trimEndNl(text: string): string {
  if (text.endsWith('\n')) return text.slice(0, -1);
  return text;
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isLetter(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isPdf(bytes: Uint8Array): boolean {
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  while (i < bytes.length) {
    const b = bytes[i]!;
    if (b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x20) break;
    i += 1;
  }
  return startsWithAscii(bytes, '%PDF-', i);
}

function startsWithAscii(bytes: Uint8Array, prefix: string, offset: number): boolean {
  if (offset + prefix.length > bytes.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[offset + i] !== prefix.charCodeAt(i)) return false;
  }
  return true;
}

function decodeHead(bytes: Uint8Array): string {
  const limit = Math.min(bytes.length, 8192);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(0, limit));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(0, limit));
  }
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(start, start + 8192));
}

const WIN1252_80_9F =
  '\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178';

function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return stripBom(new TextDecoder('utf-16le').decode(bytes));
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return stripBom(new TextDecoder('utf-16be').decode(bytes));
  }
  const rest =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? bytes.subarray(3)
      : bytes;
  try {
    return stripBom(new TextDecoder('utf-8', { fatal: true }).decode(rest));
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

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
