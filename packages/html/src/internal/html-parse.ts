import { type Attr, Element } from '@mdgate/containers';

const VOID_HTML = new Set([
  'area',
  'base',
  'basefont',
  'bgsound',
  'br',
  'col',
  'embed',
  'frame',
  'hr',
  'img',
  'input',
  'keygen',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'noscript']);

const BREAKS_P = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'div',
  'dl',
  'fieldset',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'ul',
]);

/** True when markup is well-formed XML (quoted attrs, matched tags, self-closed voids). */
export function isWellFormedXmlMarkup(s: string): boolean {
  const stack: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (s.charCodeAt(i) !== 60) {
      i += 1;
      continue;
    }
    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      if (end < 0) return false;
      i = end + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', i)) {
      const end = s.indexOf(']]>', i + 9);
      if (end < 0) return false;
      i = end + 3;
      continue;
    }
    if (s.startsWith('<?', i)) {
      const end = s.indexOf('?>', i + 2);
      if (end < 0) return false;
      i = end + 2;
      continue;
    }
    if (s.startsWith('<!', i)) {
      const end = indexDoctypeEnd(s, i);
      if (end < 0) return false;
      i = end;
      continue;
    }
    if (s.startsWith('</', i)) {
      i += 2;
      const name = readXmlName(s, i);
      if (name.length === 0) return false;
      i += name.length;
      i = skipWs(s, i);
      if (s[i] !== '>') return false;
      i += 1;
      const open = stack.pop();
      if (open === undefined || open !== name) return false;
      continue;
    }
    i += 1;
    const name = readXmlName(s, i);
    if (name.length === 0) return false;
    i += name.length;
    const attrs = readXmlishAttrs(s, i);
    if (attrs === undefined) return false;
    i = attrs.next;
    if (attrs.empty) continue;
    if (VOID_HTML.has(name.toLowerCase())) return false;
    stack.push(name);
  }
  return stack.length === 0;
}

/** Tolerant HTML5-ish parse into the same `Element` tree the EPUB walker expects. */
export function parseHtml(s: string): Element {
  const root = new Element(undefined, '');
  const stack: Element[] = [root];
  let i = 0;

  while (i < s.length) {
    if (s.charCodeAt(i) !== 60) {
      const start = i;
      const next = s.indexOf('<', i);
      i = next < 0 ? s.length : next;
      const text = decodeEntities(s.slice(start, i));
      if (text.length > 0) {
        pushText(stack[stack.length - 1]!, text);
      }
      continue;
    }

    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      i = end < 0 ? s.length : end + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', i)) {
      const end = s.indexOf(']]>', i + 9);
      const body = end < 0 ? s.slice(i + 9) : s.slice(i + 9, end);
      if (body.length > 0) {
        pushText(stack[stack.length - 1]!, body);
      }
      i = end < 0 ? s.length : end + 3;
      continue;
    }
    if (s.startsWith('<?', i)) {
      const end = s.indexOf('?>', i + 2);
      i = end < 0 ? s.length : end + 2;
      continue;
    }
    if (s.startsWith('<!', i)) {
      const end = indexDoctypeEnd(s, i);
      i = end < 0 ? s.length : end;
      continue;
    }

    if (s.startsWith('</', i)) {
      i += 2;
      const name = readHtmlName(s, i).toLowerCase();
      if (name.length === 0) {
        pushText(stack[stack.length - 1]!, '</');
        continue;
      }
      i += name.length;
      i = skipWs(s, i);
      if (s[i] === '>') i += 1;
      closeTag(stack, name);
      continue;
    }

    if (!isNameStart(s.charCodeAt(i + 1))) {
      pushText(stack[stack.length - 1]!, '<');
      i += 1;
      continue;
    }

    i += 1;
    const rawName = readHtmlName(s, i);
    const name = rawName.toLowerCase();
    i += rawName.length;
    const parsed = readHtmlAttrs(s, i);
    i = parsed.next;

    autoclose(stack, name);
    const elem = new Element(undefined, name, parsed.attrs);
    stack[stack.length - 1]!.children.push({ type: 'elem', elem });

    if (parsed.empty || VOID_HTML.has(name)) continue;

    if (RAW_TEXT.has(name)) {
      const closeAt = findRawClose(s, i, name);
      const body = closeAt < 0 ? s.slice(i) : s.slice(i, closeAt);
      if (body.length > 0) {
        elem.children.push({ type: 'text', text: body });
      }
      if (closeAt < 0) {
        i = s.length;
      } else {
        i = s.indexOf('>', closeAt);
        i = i < 0 ? s.length : i + 1;
      }
      continue;
    }

    stack.push(elem);
  }

  return root;
}

function autoclose(stack: Element[], name: string): void {
  const parent = stack[stack.length - 1];
  if (parent === undefined || stack.length < 2) return;
  const pl = parent.local;
  if (name === 'li' && pl === 'li') {
    stack.pop();
    return;
  }
  if ((name === 'dt' || name === 'dd') && (pl === 'dt' || pl === 'dd')) {
    stack.pop();
    return;
  }
  if ((name === 'td' || name === 'th') && (pl === 'td' || pl === 'th')) {
    stack.pop();
    return;
  }
  if (name === 'tr') {
    if (pl === 'td' || pl === 'th') stack.pop();
    if (stack.length >= 2 && stack[stack.length - 1]!.local === 'tr') stack.pop();
    return;
  }
  if (BREAKS_P.has(name) && pl === 'p') stack.pop();
}

function closeTag(stack: Element[], name: string): void {
  for (let i = stack.length - 1; i >= 1; i -= 1) {
    if (stack[i]!.local === name) {
      stack.length = i;
      return;
    }
  }
}

function pushText(parent: Element, text: string): void {
  const children = parent.children;
  const last = children[children.length - 1];
  if (last?.type === 'text') last.text += text;
  else children.push({ type: 'text', text });
}

function readXmlName(s: string, i: number): string {
  const start = i;
  while (i < s.length && isXmlNameChar(s.charCodeAt(i))) i += 1;
  return s.slice(start, i);
}

function readHtmlName(s: string, i: number): string {
  const start = i;
  while (i < s.length && isHtmlNameChar(s.charCodeAt(i))) i += 1;
  return s.slice(start, i);
}

function isNameStart(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 58 || c === 95;
}

function isXmlNameChar(c: number): boolean {
  return isNameStart(c) || (c >= 48 && c <= 57) || c === 45 || c === 46;
}

function isHtmlNameChar(c: number): boolean {
  return isXmlNameChar(c);
}

function readXmlishAttrs(s: string, i: number): { next: number; empty: boolean } | undefined {
  for (;;) {
    i = skipWs(s, i);
    const c = s[i];
    if (c === undefined) return undefined;
    if (c === '>') return { next: i + 1, empty: false };
    if (c === '/' && s[i + 1] === '>') return { next: i + 2, empty: true };
    const name = readXmlName(s, i);
    if (name.length === 0) return undefined;
    i += name.length;
    i = skipWs(s, i);
    if (s[i] !== '=') return undefined;
    i += 1;
    i = skipWs(s, i);
    const q = s.charCodeAt(i);
    if (q !== 34 && q !== 39) return undefined;
    i += 1;
    const end = s.indexOf(String.fromCharCode(q), i);
    if (end < 0) return undefined;
    i = end + 1;
  }
}

function readHtmlAttrs(s: string, i: number): { next: number; empty: boolean; attrs: Attr[] } {
  const attrs: Attr[] = [];
  for (;;) {
    i = skipWs(s, i);
    const c = s[i];
    if (c === undefined) return { next: i, empty: false, attrs };
    if (c === '>') return { next: i + 1, empty: false, attrs };
    if (c === '/' && s[i + 1] === '>') return { next: i + 2, empty: true, attrs };
    const rawName = readHtmlName(s, i);
    if (rawName.length === 0) {
      i += 1;
      continue;
    }
    i += rawName.length;
    i = skipWs(s, i);
    let value = '';
    if (s[i] === '=') {
      i += 1;
      i = skipWs(s, i);
      const q = s.charCodeAt(i);
      if (q === 34 || q === 39) {
        i += 1;
        const end = s.indexOf(String.fromCharCode(q), i);
        const raw = end < 0 ? s.slice(i) : s.slice(i, end);
        i = end < 0 ? s.length : end + 1;
        value = decodeEntities(raw);
      } else {
        const start = i;
        while (i < s.length) {
          const ch = s.charCodeAt(i);
          if (ch === 62 || ch === 47 || ch === 32 || ch === 9 || ch === 10 || ch === 13) break;
          i += 1;
        }
        value = decodeEntities(s.slice(start, i));
      }
    }
    attrs.push({ ns: undefined, local: rawName.toLowerCase(), value });
  }
}

function findRawClose(s: string, from: number, name: string): number {
  const needle = `</${name}`;
  let i = from;
  while (i < s.length) {
    const at = indexOfCi(s, needle, i);
    if (at < 0) return -1;
    const after = at + needle.length;
    const c = s.charCodeAt(after);
    if (c === 62 || c === 32 || c === 9 || c === 10 || c === 13 || Number.isNaN(c)) return at;
    i = at + 1;
  }
  return -1;
}

function indexOfCi(hay: string, needle: string, from: number): number {
  const n = needle.length;
  const last = hay.length - n;
  for (let i = from; i <= last; i += 1) {
    let ok = true;
    for (let j = 0; j < n; j += 1) {
      const a = hay.charCodeAt(i + j);
      const b = needle.charCodeAt(j);
      if (a === b) continue;
      const al = a >= 65 && a <= 90 ? a + 32 : a;
      const bl = b >= 65 && b <= 90 ? b + 32 : b;
      if (al !== bl) {
        ok = false;
        break;
      }
    }
    if (ok) return i;
  }
  return -1;
}

function indexDoctypeEnd(s: string, i: number): number {
  i += 2;
  let depth = 0;
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '"' || ch === "'") {
      const q = ch;
      i += 1;
      while (i < s.length && s[i] !== q) i += 1;
      if (i < s.length) i += 1;
      continue;
    }
    if (ch === '<') depth += 1;
    else if (ch === '>') {
      if (depth === 0) return i + 1;
      depth -= 1;
    }
    i += 1;
  }
  return -1;
}

function skipWs(s: string, i: number): number {
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c !== 32 && c !== 9 && c !== 10 && c !== 13) break;
    i += 1;
  }
  return i;
}

function decodeEntities(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const amp = s.indexOf('&', i);
    if (amp < 0) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, amp);
    const semi = s.indexOf(';', amp + 1);
    if (semi < 0 || semi - amp > 32) {
      out += '&';
      i = amp + 1;
      continue;
    }
    const resolved = resolveEntity(s.slice(amp + 1, semi));
    if (resolved !== undefined) {
      out += resolved;
      i = semi + 1;
    } else {
      out += '&';
      i = amp + 1;
    }
  }
  return out;
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
