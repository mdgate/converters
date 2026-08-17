import type { Converter } from '@mdgate/core';
import { csv } from '@mdgate/csv';
import { data } from '@mdgate/data';
import { doc } from '@mdgate/doc';
import { docx } from '@mdgate/docx';
import { email } from '@mdgate/email';
import { epub } from '@mdgate/epub';
import { fb2 } from '@mdgate/fb2';
import { html } from '@mdgate/html';
import { hwp } from '@mdgate/hwp';
import { svg } from '@mdgate/image';
import { ipynb } from '@mdgate/ipynb';
import { keynote } from '@mdgate/keynote';
import { latex } from '@mdgate/latex';
import { mobi } from '@mdgate/mobi';
import { numbers } from '@mdgate/numbers';
import { odf } from '@mdgate/odf';
import { onenote } from '@mdgate/onenote';
import { pages } from '@mdgate/pages';
import { pdf } from '@mdgate/pdf';
import { ppt } from '@mdgate/ppt';
import { pptx } from '@mdgate/pptx';
import { rtf } from '@mdgate/rtf';
import { subtitle } from '@mdgate/subtitle';
import { text } from '@mdgate/text';
import { visio } from '@mdgate/visio';
import { wps } from '@mdgate/wps';
import { xlsx } from '@mdgate/xlsx';
import { zip } from '@mdgate/zip';

/** Every converter that works without configuration. */
export function all(): Converter[] {
  return [
    csv(),
    text(),
    data(),
    subtitle(),
    html(),
    email(),
    ipynb(),
    svg(),
    docx(),
    doc(),
    rtf(),
    xlsx(),
    pptx(),
    ppt(),
    odf(),
    pages(),
    numbers(),
    keynote(),
    epub(),
    pdf(),
    fb2(),
    mobi(),
    latex(),
    visio(),
    onenote(),
    hwp(),
    wps(),
    zip(),
  ];
}
