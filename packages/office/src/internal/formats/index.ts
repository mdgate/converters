import type { Format } from '../format.js';
import type { Document } from '../model/index.js';
import { parse as parseCsv } from './csv.js';
import { parse as parseDoc } from './doc/index.js';
import { parse as parseDocx } from './docx/index.js';
import { parse as parseEpub } from './epub/index.js';
import { parse as parseOdf } from './odf/index.js';
import { parse as parsePpt } from './ppt/index.js';
import { parse as parsePptx } from './pptx/index.js';
import { parse as parseRtf } from './rtf/index.js';
import { parse as parseSheet } from './sheet/index.js';

/**
 * Dispatch to a format frontend. Matches anydoc `formats::parse`:
 * Excel->sheet, Csv->csv, Docx->docx, Odt|Ods|Odp->odf, Pptx->pptx,
 * Epub->epub, Rtf->rtf, Doc starting with `{\rtf` -> rtf else doc,
 * Ppt->ppt.
 */
export function parse(bytes: Uint8Array, format: Format): Document {
  switch (format) {
    case 'excel':
      return parseSheet(bytes);
    case 'csv':
      return parseCsv(bytes);
    case 'docx':
      return parseDocx(bytes);
    case 'odt':
    case 'ods':
    case 'odp':
      return parseOdf(bytes);
    case 'pptx':
      return parsePptx(bytes);
    case 'epub':
      return parseEpub(bytes);
    case 'rtf':
      return parseRtf(bytes);
    case 'doc':
      // RTF files wearing a .doc extension are common in the wild.
      if (startsWithAscii(bytes, '{\\rtf')) return parseRtf(bytes);
      return parseDoc(bytes);
    case 'ppt':
      return parsePpt(bytes);
  }
}

function startsWithAscii(bytes: Uint8Array, s: string): boolean {
  if (bytes.length < s.length) return false;
  for (let i = 0; i < s.length; i += 1) {
    if (bytes[i] !== s.charCodeAt(i)) return false;
  }
  return true;
}
