import type { Converter } from '@mdgate/core';
import { csv } from '@mdgate/csv';
import { doc } from '@mdgate/doc';
import { docx } from '@mdgate/docx';
import { epub } from '@mdgate/epub';
import { odf } from '@mdgate/odf';
import { pdf } from '@mdgate/pdf';
import { ppt } from '@mdgate/ppt';
import { pptx } from '@mdgate/pptx';
import { rtf } from '@mdgate/rtf';
import { xlsx } from '@mdgate/xlsx';

/** Every converter that works without configuration. */
export function all(): Converter[] {
  return [csv(), docx(), doc(), rtf(), xlsx(), pptx(), ppt(), odf(), epub(), pdf()];
}
