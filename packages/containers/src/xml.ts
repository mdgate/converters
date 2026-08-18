import { ConvertError } from '@mdgate/core';
import { debug, decode, encodingExists, warn } from '@mdgate/utils';

/** Well-known namespace URIs. */
export const ns = {
  W: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  R: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  A: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  PIC: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  WP: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  MC: 'http://schemas.openxmlformats.org/markup-compatibility/2006',
  CHART: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  DGM: 'http://schemas.openxmlformats.org/drawingml/2006/diagram',
  P: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  PKG_RELS: 'http://schemas.openxmlformats.org/package/2006/relationships',
  OFFICE: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  TEXT: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  TABLE: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
  DRAW: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  STYLE: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
  FO: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
  PRESENTATION: 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0',
  MANIFEST: 'urn:oasis:names:tc:opendocument:xmlns:manifest:1.0',
  XLINK: 'http://www.w3.org/1999/xlink',
  XML: 'http://www.w3.org/XML/1998/namespace',
  SVG_COMPAT: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  VML: 'urn:schemas-microsoft-com:vml',
  O_VML: 'urn:schemas-microsoft-com:office:office',
  WPS: 'http://schemas.microsoft.com/office/word/2010/wordprocessingShape',
  WPG: 'http://schemas.microsoft.com/office/word/2010/wordprocessingGroup',
} as const;

const XML_NS = ns.XML;
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';

export type XmlNode = { type: 'elem'; elem: Element } | { type: 'text'; text: string };

export interface Attr {
  ns: string | undefined;
  local: string;
  value: string;
}

const EMPTY_ATTRS: Attr[] = [];

export class Element {
  ns: string | undefined;
  local: string;
  attrs: Attr[];
  children: XmlNode[];
  private _elems: Element[] | undefined;

  constructor(
    nsUri: string | undefined,
    local: string,
    attrs: Attr[] = EMPTY_ATTRS,
    children: XmlNode[] = [],
  ) {
    this.ns = nsUri;
    this.local = local;
    this.attrs = attrs;
    this.children = children;
  }

  is(nsUri: string, local: string): boolean {
    return this.local === local && this.ns === nsUri;
  }

  /**
   * Same-vocabulary attribute lookup: the qualified attribute wins, and an
   * explicitly unqualified one with the same local name is accepted.
   */
  attr(nsUri: string, local: string): string | undefined {
    return this.attrQualified(nsUri, local) ?? this.attrUnqualified(local);
  }

  attrQualified(nsUri: string, local: string): string | undefined {
    const attrs = this.attrs;
    for (let i = 0; i < attrs.length; i += 1) {
      const a = attrs[i]!;
      if (a.local === local && a.ns === nsUri) return a.value;
    }
    return undefined;
  }

  attrUnqualified(local: string): string | undefined {
    const attrs = this.attrs;
    for (let i = 0; i < attrs.length; i += 1) {
      const a = attrs[i]!;
      if (a.local === local && a.ns === undefined) return a.value;
    }
    return undefined;
  }

  attrAny(local: string): string | undefined {
    const attrs = this.attrs;
    for (let i = 0; i < attrs.length; i += 1) {
      const a = attrs[i]!;
      if (a.local === local) return a.value;
    }
    return undefined;
  }

  childElems(): Element[] {
    if (this._elems !== undefined) return this._elems;
    const out: Element[] = [];
    const children = this.children;
    for (let i = 0; i < children.length; i += 1) {
      const n = children[i]!;
      if (n.type === 'elem') out.push(n.elem);
    }
    this._elems = out;
    return out;
  }

  find(nsUri: string, local: string): Element | undefined {
    const children = this.children;
    for (let i = 0; i < children.length; i += 1) {
      const n = children[i]!;
      if (n.type === 'elem' && n.elem.local === local && n.elem.ns === nsUri) return n.elem;
    }
    return undefined;
  }

  findAll(nsUri: string, local: string): Element[] {
    const out: Element[] = [];
    const children = this.children;
    for (let i = 0; i < children.length; i += 1) {
      const n = children[i]!;
      if (n.type === 'elem' && n.elem.local === local && n.elem.ns === nsUri) out.push(n.elem);
    }
    return out;
  }

  /** Depth-first descendant nodes in document order (iterative). */
  *descendantNodes(): Generator<XmlNode> {
    const stack = this.children.slice();
    stack.reverse();
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.type === 'elem') {
        const start = stack.length;
        for (const c of node.elem.children) stack.push(c);
        reverseRange(stack, start);
      }
      yield node;
    }
  }

  *descendantElems(): Generator<Element> {
    for (const node of this.descendantNodes()) {
      if (node.type === 'elem') yield node.elem;
    }
  }

  firstDescendant(nsUri: string, local: string): Element | undefined {
    for (const e of this.descendantElems()) {
      if (e.is(nsUri, local)) return e;
    }
    return undefined;
  }

  *descendants(nsUri: string, local: string): Generator<Element> {
    for (const e of this.descendantElems()) {
      if (e.is(nsUri, local)) yield e;
    }
  }

  *descendantsAny(local: string): Generator<Element> {
    for (const e of this.descendantElems()) {
      if (e.local === local) yield e;
    }
  }

  text(): string {
    let out = '';
    for (const node of this.descendantNodes()) {
      if (node.type === 'text') out += node.text;
    }
    return out;
  }
}

interface RawAttr {
  rawName: string;
  value: string;
}

class NsScope {
  /** Copy-on-write prefix maps: most elements inherit the parent map. */
  private readonly prefixes: Map<string, string | undefined>[] = [new Map()];
  private readonly ownsMap: boolean[] = [true];
  private defaultNs: (string | undefined)[] = [undefined];

  push(): void {
    this.prefixes.push(this.prefixes[this.prefixes.length - 1]!);
    this.ownsMap.push(false);
    this.defaultNs.push(this.defaultNs[this.defaultNs.length - 1]);
  }

  pop(): void {
    this.prefixes.pop();
    this.ownsMap.pop();
    this.defaultNs.pop();
  }

  applyDecls(attrs: RawAttr[]): void {
    for (const a of attrs) {
      if (a.rawName === 'xmlns') {
        this.defaultNs[this.defaultNs.length - 1] = a.value.length === 0 ? undefined : a.value;
      } else if (a.rawName.startsWith('xmlns:')) {
        if (!this.ownsMap[this.ownsMap.length - 1]) {
          this.prefixes[this.prefixes.length - 1] = new Map(
            this.prefixes[this.prefixes.length - 1],
          );
          this.ownsMap[this.ownsMap.length - 1] = true;
        }
        const prefix = a.rawName.slice(6);
        this.prefixes[this.prefixes.length - 1]!.set(
          prefix,
          a.value.length === 0 ? undefined : a.value,
        );
      }
    }
  }

  lookupPrefix(prefix: string): string | undefined {
    if (prefix === 'xml') return XML_NS;
    if (prefix === 'xmlns') return XMLNS_NS;
    return this.prefixes[this.prefixes.length - 1]!.get(prefix);
  }

  resolveElement(qname: string): { ns: string | undefined; local: string; bound: boolean } {
    const colon = qname.indexOf(':');
    if (colon >= 0) {
      const prefix = qname.slice(0, colon);
      const local = qname.slice(colon + 1);
      const uri = this.lookupPrefix(prefix);
      return { ns: uri, local, bound: uri !== undefined || prefix === 'xml' || prefix === 'xmlns' };
    }
    const uri = this.defaultNs[this.defaultNs.length - 1];
    return { ns: uri, local: qname, bound: uri !== undefined };
  }

  resolveAttribute(qname: string): { ns: string | undefined; local: string } {
    const colon = qname.indexOf(':');
    if (colon >= 0) {
      const prefix = qname.slice(0, colon);
      const local = qname.slice(colon + 1);
      return { ns: this.lookupPrefix(prefix), local };
    }
    return { ns: undefined, local: qname };
  }
}

/**
 * ISO/IEC 29500 Strict namespace and relationship-type URIs are the
 * Transitional ones re-rooted under `http://purl.oclc.org/ooxml/` with the
 * `2006` version segment dropped.
 */
export function normalizeOoxmlUri(uri: string): string | undefined {
  const rest = stripPrefix(uri, 'http://purl.oclc.org/ooxml/');
  if (rest === undefined) return undefined;
  const slash = rest.indexOf('/');
  if (slash < 0) return undefined;
  const family = rest.slice(0, slash);
  const tail = rest.slice(slash + 1);
  return `http://schemas.openxmlformats.org/${family}/2006/${tail}`;
}

/**
 * Parse an XML part into a synthetic root element containing the top-level
 * nodes. Encoding comes from the BOM or XML declaration.
 */
const EV_EOF = 0;
const EV_START = 1;
const EV_END = 2;
const EV_TEXT = 3;
const EV_GREF = 4;
const EV_CDATA = 5;

export function parseXml(bytes: Uint8Array): Element {
  const utf8 = toUtf8(bytes);
  const lexer = new Lexer(utf8);
  const scope = new NsScope();
  const uriInterner = new Map<string, string>();
  const nameInterner = new Map<string, string>();
  const root = new Element(undefined, '');
  const stack: Element[] = [];
  let recovered = false;

  for (;;) {
    let kind: number;
    try {
      kind = lexer.next();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw ConvertError.malformed(`unparseable xml: ${msg}`);
    }
    switch (kind) {
      case EV_START: {
        scope.push();
        scope.applyDecls(lexer.attrs);
        const elem = startToElement(lexer.name, lexer.attrs, scope, uriInterner, nameInterner);
        if (lexer.empty) {
          attach(stack, root, { type: 'elem', elem });
          scope.pop();
        } else {
          stack.push(elem);
        }
        break;
      }
      case EV_END: {
        const elem = stack.pop();
        if (elem === undefined) {
          recovered = true;
        } else {
          if (elem.local !== lexer.local) recovered = true;
          attach(stack, root, { type: 'elem', elem });
          scope.pop();
        }
        break;
      }
      case EV_TEXT: {
        if (lexer.text.length > 0) {
          pushText(stack, root, lexer.text);
        }
        break;
      }
      case EV_GREF: {
        const resolved = resolveEntity(lexer.name) ?? `&${lexer.name};`;
        pushText(stack, root, resolved);
        break;
      }
      case EV_CDATA: {
        pushText(stack, root, lexer.text);
        break;
      }
      case EV_EOF:
        if (stack.length > 0) {
          recovered = true;
          while (stack.length > 0) {
            attach(stack, root, { type: 'elem', elem: stack.pop()! });
          }
        }
        if (recovered) {
          warn('recovered malformed xml (unclosed or mismatched elements)');
        }
        return root;
    }
  }
}

function attach(stack: Element[], root: Element, node: XmlNode): void {
  const parent = stack[stack.length - 1];
  if (parent !== undefined) parent.children.push(node);
  else root.children.push(node);
}

function pushText(stack: Element[], root: Element, text: string): void {
  const target = stack[stack.length - 1]?.children ?? root.children;
  const last = target[target.length - 1];
  if (last?.type === 'text') last.text += text;
  else target.push({ type: 'text', text });
}

function intern(interner: Map<string, string>, uri: string): string {
  const hit = interner.get(uri);
  if (hit !== undefined) return hit;
  const normalized = normalizeOoxmlUri(uri) ?? uri;
  interner.set(uri, normalized);
  return normalized;
}

function internName(interner: Map<string, string>, name: string): string {
  const hit = interner.get(name);
  if (hit !== undefined) return hit;
  interner.set(name, name);
  return name;
}

function startToElement(
  qname: string,
  rawAttrs: RawAttr[],
  scope: NsScope,
  uriInterner: Map<string, string>,
  nameInterner: Map<string, string>,
): Element {
  const resolved = scope.resolveElement(qname);
  const nsUri = resolved.ns !== undefined ? intern(uriInterner, resolved.ns) : undefined;
  let attrs: Attr[] = EMPTY_ATTRS;
  let wrote = false;
  for (const a of rawAttrs) {
    if (a.rawName === 'xmlns' || a.rawName.startsWith('xmlns:')) continue;
    const ra = scope.resolveAttribute(a.rawName);
    if (!wrote) {
      attrs = [];
      wrote = true;
    }
    attrs.push({
      ns: ra.ns !== undefined ? intern(uriInterner, ra.ns) : undefined,
      local: internName(nameInterner, ra.local),
      value: a.value,
    });
  }
  if (resolved.local === 'Choice' && nsUri === ns.MC) {
    const requires = attrs.find((a) => a.local === 'Requires');
    if (requires !== undefined) {
      requires.value = requires.value
        .split(/\s+/)
        .filter((p) => p.length > 0)
        .map((prefix) => {
          const probe = scope.resolveElement(`${prefix}:x`);
          if (probe.bound && probe.ns !== undefined) {
            return normalizeOoxmlUri(probe.ns) ?? probe.ns;
          }
          return prefix;
        })
        .join(' ');
    }
  }
  return new Element(nsUri, internName(nameInterner, resolved.local), attrs);
}

function toUtf8(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes);
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  const head = bytes.subarray(0, Math.min(bytes.length, 200));
  const label = declaredEncoding(head);
  if (label !== undefined) {
    const enc = encodingForLabel(label);
    if (enc !== undefined && enc !== 'utf8' && enc !== 'utf-8') {
      return decode(bytes, enc);
    }
  }
  return new TextDecoder('utf-8').decode(bytes);
}

function declaredEncoding(head: Uint8Array): string | undefined {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(head);
  } catch {
    return undefined;
  }
  const idx = text.indexOf('encoding');
  if (idx < 0) return undefined;
  let rest = text.slice(idx + 'encoding'.length).trimStart();
  if (!rest.startsWith('=')) return undefined;
  rest = rest.slice(1).trimStart();
  const quote = rest[0];
  if (quote !== '"' && quote !== "'") return undefined;
  rest = rest.slice(1);
  const end = rest.indexOf(quote);
  if (end < 0) return undefined;
  return rest.slice(0, end);
}

function encodingForLabel(label: string): string | undefined {
  const n = label.trim().toLowerCase().replace(/_/g, '-');
  const aliases: Record<string, string> = {
    'utf-8': 'utf8',
    utf8: 'utf8',
    'utf-16': 'utf16-le',
    'utf-16le': 'utf16-le',
    'utf-16be': 'utf16-be',
    'iso-8859-1': 'iso-8859-1',
    'latin-1': 'iso-8859-1',
    latin1: 'iso-8859-1',
    'windows-1252': 'windows-1252',
    'cp-1252': 'windows-1252',
    cp1252: 'windows-1252',
    'windows-1251': 'windows-1251',
    'windows-1250': 'windows-1250',
    'windows-874': 'windows-874',
    gbk: 'gbk',
    gb2312: 'gb2312',
    gb18030: 'gb18030',
    big5: 'big5',
    'shift-jis': 'shiftjis',
    shiftjis: 'shiftjis',
    'euc-jp': 'euc-jp',
    'euc-kr': 'euc-kr',
    koi8r: 'koi8-r',
    'koi8-r': 'koi8-r',
  };
  const mapped = aliases[n] ?? n;
  return encodingExists(mapped) ? mapped : undefined;
}

function resolveEntity(name: string): string | undefined {
  if (name.startsWith('#')) {
    const num = name.slice(1);
    const hex = num.startsWith('x') || num.startsWith('X');
    const digits = hex ? num.slice(1) : num;
    const code = Number.parseInt(digits, hex ? 16 : 10);
    if (!Number.isFinite(code)) return undefined;
    try {
      return String.fromCodePoint(code);
    } catch {
      return undefined;
    }
  }
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    apos: "'",
    quot: '"',
    nbsp: '\u00a0',
    shy: '\u00ad',
    mdash: '\u2014',
    ndash: '\u2013',
    lsquo: '\u2018',
    rsquo: '\u2019',
    ldquo: '\u201c',
    rdquo: '\u201d',
    hellip: '\u2026',
    copy: '\u00a9',
    reg: '\u00ae',
    trade: '\u2122',
    deg: '\u00b0',
    middot: '\u00b7',
    bull: '\u2022',
    sect: '\u00a7',
    para: '\u00b6',
    laquo: '\u00ab',
    raquo: '\u00bb',
    times: '\u00d7',
    divide: '\u00f7',
    plusmn: '\u00b1',
    frac12: '\u00bd',
    frac14: '\u00bc',
    eacute: '\u00e9',
    egrave: '\u00e8',
    agrave: '\u00e0',
    ccedil: '\u00e7',
    uuml: '\u00fc',
    ouml: '\u00f6',
    auml: '\u00e4',
    szlig: '\u00df',
    aring: '\u00e5',
    oslash: '\u00f8',
    aelig: '\u00e6',
    euro: '\u20ac',
    pound: '\u00a3',
    yen: '\u00a5',
    cent: '\u00a2',
  };
  return named[name];
}

class Lexer {
  private readonly s: string;
  private i = 0;
  name = '';
  local = '';
  text = '';
  empty = false;
  attrs: RawAttr[] = [];

  constructor(s: string) {
    this.s = s;
  }

  next(): number {
    if (this.i >= this.s.length) return EV_EOF;
    if (this.s.charCodeAt(this.i) === 60) {
      return this.markup();
    }
    return this.textRun();
  }

  private markup(): number {
    if (this.startsWith('<?')) {
      this.skipUntil('?>');
      return this.next();
    }
    if (this.startsWith('<!--')) {
      this.i += 4;
      const end = this.s.indexOf('-->', this.i);
      if (end < 0) throw new Error('unterminated comment');
      this.i = end + 3;
      return this.next();
    }
    if (this.startsWith('<![CDATA[')) {
      this.i += 9;
      const end = this.s.indexOf(']]>', this.i);
      if (end < 0) throw new Error('unterminated cdata');
      this.text = this.s.slice(this.i, end);
      this.i = end + 3;
      return EV_CDATA;
    }
    if (this.startsWith('<!')) {
      this.skipDoctype();
      return this.next();
    }
    if (this.startsWith('</')) {
      this.i += 2;
      const name = this.readName();
      this.skipWs();
      if (this.s[this.i] === '>') this.i += 1;
      this.local = localName(name);
      return EV_END;
    }
    this.i += 1;
    this.name = this.readName();
    this.attrs = this.readAttrs();
    this.skipWs();
    this.empty = false;
    if (this.s[this.i] === '/' && this.s[this.i + 1] === '>') {
      this.i += 2;
      this.empty = true;
    } else if (this.s[this.i] === '>') {
      this.i += 1;
    }
    return EV_START;
  }

  private textRun(): number {
    const start = this.i;
    while (this.i < this.s.length) {
      const c = this.s.charCodeAt(this.i);
      if (c === 60) break;
      if (c === 38) {
        if (this.i > start) {
          this.text = this.s.slice(start, this.i);
          return EV_TEXT;
        }
        const ref = this.readReference();
        if (ref.type === 'general') {
          this.name = ref.name;
          return EV_GREF;
        }
        this.i = start;
        return this.textRunSlow();
      }
      this.i += 1;
    }
    this.text = this.s.slice(start, this.i);
    return EV_TEXT;
  }

  private textRunSlow(): number {
    let out = '';
    while (this.i < this.s.length) {
      const c = this.s.charCodeAt(this.i);
      if (c === 60) break;
      if (c === 38) {
        const ref = this.readReference();
        if (ref.type === 'general') {
          if (out.length > 0) {
            this.i = ref.rewind;
            this.text = out;
            return EV_TEXT;
          }
          this.name = ref.name;
          return EV_GREF;
        }
        out += ref.text;
        continue;
      }
      const run = this.i;
      this.i += 1;
      while (this.i < this.s.length) {
        const d = this.s.charCodeAt(this.i);
        if (d === 60 || d === 38) break;
        this.i += 1;
      }
      out += this.s.slice(run, this.i);
    }
    this.text = out;
    return EV_TEXT;
  }

  private readReference():
    | { type: 'char'; text: string }
    | { type: 'general'; name: string; rewind: number } {
    const start = this.i;
    this.i += 1;
    const end = this.s.indexOf(';', this.i);
    if (end < 0) {
      return { type: 'char', text: '&' };
    }
    const name = this.s.slice(this.i, end);
    this.i = end + 1;
    if (
      name.startsWith('#') ||
      name === 'amp' ||
      name === 'lt' ||
      name === 'gt' ||
      name === 'apos' ||
      name === 'quot'
    ) {
      return { type: 'char', text: resolveEntity(name) ?? `&${name};` };
    }
    return { type: 'general', name, rewind: start };
  }

  private readName(): string {
    const start = this.i;
    while (this.i < this.s.length) {
      const c = this.s.charCodeAt(this.i);
      if (c === 47 || c === 62 || c === 61 || c === 32 || c === 9 || c === 10 || c === 13) {
        break;
      }
      this.i += 1;
    }
    return this.s.slice(start, this.i);
  }

  private readAttrs(): RawAttr[] {
    const attrs: RawAttr[] = [];
    for (;;) {
      this.skipWs();
      const c = this.s[this.i];
      if (c === undefined || c === '>' || c === '/') break;
      const rawName = this.readName();
      if (rawName.length === 0) {
        this.i += 1;
        continue;
      }
      this.skipWs();
      if (this.s[this.i] !== '=') {
        debug(`dropping undecodable attribute: ${rawName}`);
        continue;
      }
      this.i += 1;
      this.skipWs();
      const value = this.readAttrValue();
      if (value === undefined) {
        debug(`dropping undecodable attribute: ${rawName}`);
        continue;
      }
      attrs.push({ rawName, value });
    }
    return attrs;
  }

  private readAttrValue(): string | undefined {
    const q = this.s.charCodeAt(this.i);
    if (q !== 34 && q !== 39) return undefined;
    this.i += 1;
    const start = this.i;
    let needsNorm = false;
    while (this.i < this.s.length) {
      const c = this.s.charCodeAt(this.i);
      if (c === q) {
        const raw = this.s.slice(start, this.i);
        this.i += 1;
        return needsNorm ? normalizeAttrValue(raw) : raw;
      }
      if (c === 38) {
        this.i = start;
        return this.readAttrValueSlow(q);
      }
      if (c === 9 || c === 10 || c === 13) needsNorm = true;
      this.i += 1;
    }
    const raw = this.s.slice(start, this.i);
    return needsNorm ? normalizeAttrValue(raw) : raw;
  }

  private readAttrValueSlow(q: number): string {
    let out = '';
    while (this.i < this.s.length) {
      const c = this.s.charCodeAt(this.i);
      if (c === q) {
        this.i += 1;
        return normalizeAttrValue(out);
      }
      if (c === 38) {
        const ref = this.readReference();
        if (ref.type === 'char') out += ref.text;
        else out += resolveEntity(ref.name) ?? `&${ref.name};`;
        continue;
      }
      const run = this.i;
      this.i += 1;
      while (this.i < this.s.length) {
        const d = this.s.charCodeAt(this.i);
        if (d === q || d === 38) break;
        this.i += 1;
      }
      out += this.s.slice(run, this.i);
    }
    return normalizeAttrValue(out);
  }

  private skipWs(): void {
    while (this.i < this.s.length) {
      const c = this.s.charCodeAt(this.i);
      if (c !== 32 && c !== 9 && c !== 10 && c !== 13) break;
      this.i += 1;
    }
  }

  private startsWith(s: string): boolean {
    return this.s.startsWith(s, this.i);
  }

  private skipUntil(end: string): void {
    const idx = this.s.indexOf(end, this.i);
    this.i = idx < 0 ? this.s.length : idx + end.length;
  }

  private skipDoctype(): void {
    this.i += 2;
    let depth = 0;
    while (this.i < this.s.length) {
      const ch = this.s[this.i]!;
      if (ch === '"' || ch === "'") {
        const q = ch;
        this.i += 1;
        while (this.i < this.s.length && this.s[this.i] !== q) this.i += 1;
        if (this.i < this.s.length) this.i += 1;
        continue;
      }
      if (ch === '<') depth += 1;
      else if (ch === '>') {
        if (depth === 0) {
          this.i += 1;
          return;
        }
        depth -= 1;
      }
      this.i += 1;
    }
  }
}

function localName(qname: string): string {
  const colon = qname.indexOf(':');
  return colon < 0 ? qname : qname.slice(colon + 1);
}

function normalizeAttrValue(value: string): string {
  if (value.indexOf('\t') < 0 && value.indexOf('\n') < 0 && value.indexOf('\r') < 0) return value;
  return value.replace(/[\t\n\r]/g, ' ');
}

function reverseRange<T>(arr: T[], start: number): void {
  let i = start;
  let j = arr.length - 1;
  while (i < j) {
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
    i += 1;
    j -= 1;
  }
}

function stripPrefix(s: string, prefix: string): string | undefined {
  return s.startsWith(prefix) ? s.slice(prefix.length) : undefined;
}
