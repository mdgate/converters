import { detectOleDoc, detectZipDoc, Package } from '@mdgate/containers';
import type { Convert, Converter, ConvertHint, ConvertOptions, ConvertResult } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import { type Document, documentToMarkdown, emptyDocument, heading, plain } from '@mdgate/document';
import { fileExtension } from '@mdgate/utils';
import { extractDocument, looksEncrypted } from './internal/extract.js';
import { hasOle, isOleOneNote, isOneNote, isPdf, isZip } from './internal/header.js';

const EXTS = new Set(['one', 'onetoc2', 'onepkg']);

export function onenote(): Converter {
  return {
    id: 'onenote',
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (isOneNote(bytes)) return 2;
      if (hint?.path !== undefined && EXTS.has(fileExtension(hint.path) ?? '')) return 1;
      return 0;
    },
    convert(bytes: Uint8Array, options?: ConvertOptions): ConvertResult | Promise<ConvertResult> {
      refuseForeign(bytes, options?.path);
      if (looksEncrypted(bytes)) throw ConvertError.encrypted();
      if (isZip(bytes)) return convertOnepkg(bytes, options);
      return { markdown: documentToMarkdown(extractDocument(bytes)) };
    },
  };
}

function refuseForeign(bytes: Uint8Array, path: string | undefined): void {
  if (isPdf(bytes)) throw ConvertError.unsupported('pdf');
  const oleKind = detectOleDoc(bytes) as string | undefined;
  if (oleKind !== undefined && oleKind !== 'one' && !isOleOneNote(bytes)) {
    throw ConvertError.unsupported(oleKind);
  }
  if (hasOle(bytes) && !isOneNote(bytes) && !isOnePath(path)) {
    throw ConvertError.unsupported(oleKind ?? 'ole');
  }
  const zipKind = detectZipDoc(bytes);
  if (zipKind !== undefined) throw ConvertError.unsupported(zipKind);
  if (isZip(bytes)) return;
  if (isOneNote(bytes) || isOnePath(path)) return;
  throw ConvertError.unsupported('onenote');
}

function isOnePath(path: string | undefined): boolean {
  if (path === undefined) return false;
  return EXTS.has(fileExtension(path) ?? '');
}

function convertOnepkg(
  bytes: Uint8Array,
  options: ConvertOptions | undefined,
): ConvertResult | Promise<ConvertResult> {
  let pkg: Package;
  try {
    pkg = Package.open(bytes);
  } catch (e) {
    throw mapZipOpenError(e);
  }
  const ones = oneMembers(pkg);
  const names = ones.length > 0 ? ones : listableMembers(pkg);
  if (options?.convert !== undefined && ones.length > 0) {
    return convertMembers(pkg, ones, options.convert);
  }
  return { markdown: documentToMarkdown(listDocument(names)) };
}

async function convertMembers(
  pkg: Package,
  names: string[],
  convert: Convert,
): Promise<ConvertResult> {
  const sections: string[] = [];
  for (const name of names) {
    const title = renderHeading(name);
    let member: Uint8Array | undefined;
    try {
      member = pkg.part(name);
    } catch (e) {
      if (e instanceof ConvertError && e.isFatal()) throw e;
      if (isEncryptedError(e)) throw ConvertError.encrypted();
      sections.push(joinSection(title, renderFailure(reasonOf(e))));
      continue;
    }
    if (member === undefined) {
      sections.push(joinSection(title, renderFailure(`missing required part: ${name}`)));
      continue;
    }
    try {
      const md = await convert(member, { path: name });
      sections.push(joinSection(title, md.trimEnd()));
    } catch (e) {
      if (e instanceof ConvertError && e.isFatal()) throw e;
      if (isEncryptedError(e)) throw ConvertError.encrypted();
      sections.push(joinSection(title, renderFailure(reasonOf(e))));
    }
  }
  return { markdown: joinSections(sections) };
}

function oneMembers(pkg: Package): string[] {
  const out: string[] = [];
  for (const name of pkg.partNames()) {
    if (!isOneMember(name)) continue;
    out.push(name);
  }
  return out;
}

function listableMembers(pkg: Package): string[] {
  const out: string[] = [];
  for (const name of pkg.partNames()) {
    if (name.endsWith('/')) continue;
    if (isMacosx(name)) continue;
    out.push(name);
  }
  return out;
}

function isOneMember(name: string): boolean {
  if (name.endsWith('/') || isMacosx(name)) return false;
  const ext = fileExtension(name);
  return ext === 'one' || ext === 'onetoc2';
}

function isMacosx(name: string): boolean {
  for (const part of name.split('/')) {
    if (part === '__MACOSX') return true;
  }
  return false;
}

function listDocument(names: string[]): Document {
  if (names.length === 0) return emptyDocument();
  return {
    blocks: [
      {
        type: 'list',
        list: {
          marker: 'bullet',
          start: 1,
          items: names.map((name) => ({
            blocks: [{ type: 'paragraph', inlines: [plain(name)] }],
            checked: undefined,
            markerLabel: undefined,
          })),
        },
      },
    ],
    notes: [],
    assets: [],
  };
}

function renderHeading(path: string): string {
  return documentToMarkdown({
    blocks: [heading(2, [plain(path)])],
    notes: [],
    assets: [],
  }).trimEnd();
}

function renderFailure(reason: string): string {
  return documentToMarkdown({
    blocks: [{ type: 'paragraph', inlines: [plain(`could not convert: ${reason}`)] }],
    notes: [],
    assets: [],
  }).trimEnd();
}

function joinSection(title: string, body: string): string {
  return body.length === 0 ? title : `${title}\n\n${body}`;
}

function joinSections(sections: string[]): string {
  const nonempty = sections.filter((s) => s.length > 0);
  return nonempty.length === 0 ? '' : `${nonempty.join('\n\n')}\n`;
}

function reasonOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function mapZipOpenError(e: unknown): ConvertError {
  if (e instanceof ConvertError) {
    if (e.code === 'encrypted' || isEncryptedError(e)) return ConvertError.encrypted();
    if (e.isFatal()) return e;
    return ConvertError.unsupported('zip');
  }
  const text = e instanceof Error ? e.message : String(e);
  if (isEncryptedText(text)) return ConvertError.encrypted();
  return ConvertError.unsupported('zip');
}

function isEncryptedError(e: unknown): boolean {
  if (e instanceof ConvertError && e.code === 'encrypted') return true;
  const detail = e instanceof ConvertError ? (e.detail ?? '') : '';
  const text = e instanceof Error ? `${e.message} ${detail}` : String(e);
  return isEncryptedText(text);
}

function isEncryptedText(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('encrypted') || lower.includes('password');
}
