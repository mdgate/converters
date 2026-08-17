import { detectZipDoc, hasOleMagic, Package } from '@mdgate/containers';
import type { Convert, Converter, ConvertHint, ConvertOptions, ConvertResult } from '@mdgate/core';
import { ConvertError } from '@mdgate/core';
import { type Document, documentToMarkdown, emptyDocument, heading, plain } from '@mdgate/document';
import { fileExtension } from '@mdgate/utils';

const EXTS = new Set(['zip', 'zipx', 'jar']);

export function zip(): Converter {
  return {
    id: 'zip',
    // Office/ODF/EPUB/iWork packages win at 2 via detectZipDoc; leftover PK zips score 2 here.
    sniff(bytes: Uint8Array, hint?: ConvertHint): number {
      if (detectZipDoc(bytes) !== undefined) return 0;
      if (isZipMagic(bytes)) return 2;
      if (hint?.path !== undefined && EXTS.has(fileExtension(hint.path) ?? '')) return 1;
      return 0;
    },
    convert(bytes: Uint8Array, options?: ConvertOptions): ConvertResult | Promise<ConvertResult> {
      refuseNonZip(bytes);
      let pkg: Package;
      try {
        pkg = Package.open(bytes);
      } catch (e) {
        throw mapOpenError(e);
      }
      const names = memberNames(pkg);
      if (options?.convert === undefined) {
        return { markdown: documentToMarkdown(listDocument(names)) };
      }
      return convertMembers(pkg, names, options.convert);
    },
  };
}

function refuseNonZip(bytes: Uint8Array): void {
  if (isZipMagic(bytes)) return;
  if (isPdf(bytes)) throw ConvertError.unsupported('pdf');
  if (hasOleMagic(bytes)) throw ConvertError.unsupported('ole');
  throw ConvertError.unsupported('zip');
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
      sections.push(joinSection(title, renderFailure(reasonOf(e))));
    }
  }
  return { markdown: joinSections(sections) };
}

function memberNames(pkg: Package): string[] {
  const out: string[] = [];
  for (const name of pkg.partNames()) {
    if (name.endsWith('/')) continue;
    if (isMacosx(name)) continue;
    out.push(name);
  }
  return out;
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

function mapOpenError(e: unknown): ConvertError {
  if (e instanceof ConvertError) {
    if (e.code === 'encrypted') return e;
    if (isEncryptedError(e)) return ConvertError.encrypted();
    return e;
  }
  const text = e instanceof Error ? e.message : String(e);
  if (isEncryptedText(text)) return ConvertError.encrypted();
  return ConvertError.malformed(`not a readable zip archive: ${text}`);
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

function isZipMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}
