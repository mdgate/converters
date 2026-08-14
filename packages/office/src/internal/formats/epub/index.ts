/** EPUB: XHTML chapters in spine order, with chapter-scoped anchors. */

import { AssetSink, mediaTypeFor } from '../../common/assets.js';
import { type HtmlCtx, Stylesheet, toBlocks } from '../../common/html.js';
import { isAbsoluteUri } from '../../common/uri.js';
import { ConvertError } from '../../error.js';
import { warn } from '../../log.js';
import {
  type AnchorId,
  type Document,
  emptyDocument,
  heading,
  type ImageSource,
  type LinkTarget,
  plain,
} from '../../model/index.js';
import { decodeFragment, Package, resolve } from '../../package/index.js';
import type { Element } from '../../package/xml.js';
import { trim } from '../../unicode.js';

export function parse(bytes: Uint8Array): Document {
  const pkg = Package.open(bytes);

  const container = pkg.requiredXmlPart('META-INF/container.xml');
  let opfPath: string | undefined;
  for (const r of container.descendantsAny('rootfile')) {
    opfPath = r.attrAny('full-path');
    break;
  }
  if (opfPath === undefined) {
    throw ConvertError.malformedPart('META-INF/container.xml', 'no rootfile entry');
  }

  const opf = pkg.requiredXmlPart(opfPath);

  const doc = emptyDocument();
  for (const t of opf.descendantsAny('title')) {
    const title = trim(t.text());
    if (title.length > 0) doc.blocks.push(heading(1, [plain(title)]));
    break;
  }

  const manifest = new Map<string, { href: string; media: string }>();
  for (const item of opf.descendantsAny('item')) {
    const id = item.attrAny('id');
    const href = item.attrAny('href');
    if (id === undefined || href === undefined) continue;
    manifest.set(id, { href, media: item.attrAny('media-type') ?? '' });
  }

  // Every spine part in spine order: non-linear items are auxiliary but
  // still publication content, and unusable parts degrade at parse time.
  // Intra-book links target these; links to any other resource stay
  // Relative.
  const spineHrefs: string[] = [];
  for (const ir of opf.descendantsAny('itemref')) {
    const idref = ir.attrAny('idref');
    if (idref === undefined) continue;
    const entry = manifest.get(idref);
    if (entry !== undefined) spineHrefs.push(entry.href);
  }
  const spineParts = new Set<string>();
  for (const href of spineHrefs) {
    try {
      spineParts.add(resolve(opfPath, href).path);
    } catch {
      // unresolvable hrefs stay out of the spine-part set
    }
  }

  const assets = new AssetSink();
  const cssCache = new Map<string, Stylesheet | undefined>();
  let failed = 0;
  for (const href of spineHrefs) {
    let chapterPath: string;
    try {
      chapterPath = resolve(opfPath, href).path;
    } catch (e) {
      warn(`skipping chapter with unresolvable href ${jsonDebug(href)}: ${formatErr(e)}`);
      failed += 1;
      continue;
    }
    const tree = pkg.optionalXmlPart(chapterPath);
    if (tree === undefined) {
      warn(`skipping unusable chapter ${chapterPath}`);
      failed += 1;
      continue;
    }
    const html = tree.childElems().find((e) => e.local === 'html');
    const body = html?.childElems().find((e) => e.local === 'body');
    if (body === undefined) {
      warn(`skipping chapter ${chapterPath}: no body element`);
      failed += 1;
      continue;
    }
    const css = chapterStylesheet(tree, chapterPath, pkg, cssCache);
    const ctx = new ChapterCtx(pkg, assets, chapterPath, spineParts);
    // Chapter-start anchor: renders only when a link targets this chapter.
    doc.blocks.push({ type: 'paragraph', inlines: [{ type: 'anchor', id: chapterPath }] });
    doc.blocks.push(...toBlocks(body, css, ctx));
  }
  if (spineHrefs.length > 0 && failed === spineHrefs.length) {
    throw ConvertError.malformed('no chapter in the book could be read');
  }

  doc.assets = assets.assets;
  return doc;
}

/** A chapter's CSS cascade: its linked stylesheets and inline `<style>` blocks, in document order. */
function chapterStylesheet(
  tree: Element,
  chapterPath: string,
  pkg: Package,
  cache: Map<string, Stylesheet | undefined>,
): Stylesheet {
  const css = new Stylesheet();
  const stack = tree.childElems();
  stack.reverse();
  while (stack.length > 0) {
    const elem = stack.pop()!;
    switch (elem.local) {
      case 'link': {
        const rel = elem.attrAny('rel') ?? '';
        const isSheet = rel.split(/\s+/).some((r) => eqIgnoreAsciiCase(r, 'stylesheet'));
        const href = elem.attrAny('href');
        if (isSheet && href !== undefined) {
          let targetPath: string;
          try {
            targetPath = resolve(chapterPath, href).path;
          } catch {
            break;
          }
          if (!cache.has(targetPath)) {
            const bytes = pkg.optionalPart(targetPath);
            if (bytes === undefined) {
              cache.set(targetPath, undefined);
            } else {
              const sheet = new Stylesheet();
              sheet.add(utf8Lossy(bytes));
              cache.set(targetPath, sheet);
            }
          }
          const cached = cache.get(targetPath);
          if (cached !== undefined) css.addFrom(cached);
        }
        break;
      }
      case 'style':
        css.add(elem.text());
        break;
      default: {
        const start = stack.length;
        for (const child of elem.childElems()) stack.push(child);
        reverseRange(stack, start);
        break;
      }
    }
  }
  return css;
}

class ChapterCtx implements HtmlCtx {
  constructor(
    private readonly pkg: Package,
    private readonly assets: AssetSink,
    private readonly chapterPath: string,
    private readonly spineParts: Set<string>,
  ) {}

  linkTarget(href: string): LinkTarget | undefined {
    if (href.length === 0) return undefined;
    if (href.startsWith('#')) {
      const fragment = decodeFragment(href.slice(1));
      return { type: 'anchor', id: scoped(this.chapterPath, fragment) };
    }
    if (isAbsoluteUri(href)) return { type: 'external', url: href };
    // Anchors only for converted spine documents; links to any other
    // package resource (images, downloads, non-linear content) keep
    // their relative form.
    try {
      const target = resolve(this.chapterPath, href);
      if (this.spineParts.has(target.path)) {
        return { type: 'anchor', id: scoped(target.path, target.fragment) };
      }
    } catch {
      // unresolvable package refs stay relative
    }
    return { type: 'relative', url: href };
  }

  imageSource(src: string): ImageSource | undefined {
    if (src.length === 0) return undefined;
    if (isAbsoluteUri(src)) return { type: 'external', url: src };
    let targetPath: string;
    try {
      targetPath = resolve(this.chapterPath, src).path;
    } catch {
      return undefined;
    }
    const bytes = this.pkg.optionalPart(targetPath);
    if (bytes === undefined) return undefined;
    const id = this.assets.add(mediaTypeFor(targetPath), targetPath, bytes);
    return { type: 'asset', id };
  }

  anchorId(raw: string): AnchorId {
    return scoped(this.chapterPath, raw);
  }
}

/** Chapter-scoped anchor id: the chapter path itself, or `path#fragment`. */
function scoped(chapterPath: string, fragment: string | undefined): AnchorId {
  if (fragment !== undefined && fragment.length > 0) return `${chapterPath}#${fragment}`;
  return chapterPath;
}

function utf8Lossy(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function eqIgnoreAsciiCase(s: string, target: string): boolean {
  if (s.length !== target.length) return false;
  for (let i = 0; i < s.length; i += 1) {
    const a = s.charCodeAt(i);
    const b = target.charCodeAt(i);
    if (asciiFold(a) !== asciiFold(b)) return false;
  }
  return true;
}

function asciiFold(c: number): number {
  return c >= 65 && c <= 90 ? c + 32 : c;
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

function jsonDebug(s: string): string {
  return JSON.stringify(s);
}

function formatErr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
