import { create } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { data } from '../../data/src/index.js';
import { doc } from '../../doc/src/index.js';
import { email } from '../../email/src/index.js';
import { epub } from '../../epub/src/index.js';
import { html } from '../../html/src/index.js';
import { svg } from '../../image/src/index.js';
import { ipynb } from '../../ipynb/src/index.js';
import { odf } from '../../odf/src/index.js';
import { pages } from '../../pages/src/index.js';
import { subtitle } from '../../subtitle/src/index.js';
import { text } from '../../text/src/index.js';
import { zip } from '../../zip/src/index.js';

const enc = new TextEncoder();

describe('sniff routing', () => {
  const convert = create([
    data(),
    subtitle(),
    html(),
    email(),
    ipynb(),
    svg(),
    odf(),
    zip(),
    pages(),
    epub(),
  ]);

  it('sends nbformat 2 worksheets to ipynb, not data', async () => {
    const bytes = enc.encode(
      JSON.stringify({
        nbformat: 2,
        nbformat_minor: 0,
        metadata: {},
        worksheets: [{ cells: [{ cell_type: 'markdown', source: ['# Old\n'] }] }],
      }),
    );
    await expect(convert(bytes, { path: 'old.ipynb' })).resolves.toContain('# Old');
  });

  it('sends iBooks to epub, not pages', async () => {
    const convertBook = create([pages(), epub()]);
    await expect(
      convertBook(book('application/x-ibooks+zip'), { path: 'n.ibooks' }),
    ).resolves.toContain('chapter');
  });

  it('sends notebooks to ipynb, not data', async () => {
    const bytes = enc.encode(
      JSON.stringify({
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {},
        cells: [{ cell_type: 'markdown', metadata: {}, source: ['# Title\n'] }],
      }),
    );
    await expect(convert(bytes, { path: 'note.ipynb' })).resolves.toContain('# Title');
  });

  it('does not send YAML with an indented from key to email', async () => {
    const bytes = enc.encode("---\n- name: x\n  from: '@perlpunk'\n");
    await expect(convert(bytes, { path: '26DV.yaml' })).resolves.toContain('```yaml');
  });

  it('sends MHTML to html and EML with an XHTML part to email', async () => {
    const mhtml = enc.encode(
      [
        'From: a@b',
        'MIME-Version: 1.0',
        'Content-Type: multipart/related; boundary="x"',
        '',
        '--x',
        'Content-Type: text/html',
        'Content-Location: cid:body',
        '',
        '<html><p>Saved page</p></html>',
        '--x--',
        '',
      ].join('\r\n'),
    );
    await expect(convert(mhtml, { path: 'saved.mhtml' })).resolves.toContain('Saved page');

    const eml = enc.encode(
      [
        'From: a@b',
        'Subject: Xhtml mail',
        'MIME-Version: 1.0',
        'Content-Type: text/html',
        '',
        '<html xmlns="http://www.w3.org/1999/xhtml"><p>Message body</p></html>',
        '',
      ].join('\r\n'),
    );
    const md = await convert(eml, { path: 'note.eml' });
    expect(md).toContain('Xhtml mail');
    expect(md).toContain('Message body');
  });

  it('sends SVG with an XHTML namespace to svg', async () => {
    const bytes = enc.encode(
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:html="http://www.w3.org/1999/xhtml"><text>Glyph</text></svg>',
    );
    await expect(convert(bytes, { path: 'mark.svg' })).resolves.toBe('Glyph\n');
  });

  it('sends ASS to subtitle, not data', async () => {
    const bytes = enc.encode(
      '[Script Info]\nTitle: x\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hello\n',
    );
    await expect(convert(bytes, { path: 'clip.ass' })).resolves.toContain('Hello');
  });

  it('sends Graphviz .dot to text, not doc', async () => {
    const convertDot = create([text(), doc()]);
    await expect(convertDot(enc.encode('digraph { a -> b; }\n'), { path: 'g.dot' })).resolves.toBe(
      '```dot\ndigraph { a -> b; }\n```\n',
    );
    await expect(
      convertDot(enc.encode('// c\ngraph { a -- b; }\n'), { path: 'g.dot' }),
    ).resolves.toBe('```dot\n// c\ngraph { a -- b; }\n```\n');
    await expect(
      convertDot(enc.encode('/* c */\ndigraph tika {\n  a -> b;\n}\n'), {
        path: 'testGRAPHVIZdc.dot',
      }),
    ).resolves.toContain('```dot');
  });

  it('sends LRC and MicroDVD to subtitle, not data', async () => {
    await expect(
      convert(enc.encode('[ti:Demo]\n[00:01.00]Hello\n'), { path: 'clip.lrc' }),
    ).resolves.toContain('Hello');
    await expect(convert(enc.encode('{0}{25}Hello\n'), { path: 'clip.sub' })).resolves.toContain(
      'Hello',
    );
    await expect(
      convert(enc.encode('[0][12]Foo|bar|bla\n'), { path: 'clip.txt' }),
    ).resolves.toContain('Foo bar bla');
  });
});

function book(mimetype: string): Uint8Array {
  return zipStore({
    mimetype,
    'META-INF/container.xml': `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
    'EPUB/content.opf': `<?xml version="1.0"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:uuid:1</dc:identifier>
    <dc:title>Hello</dc:title>
  </metadata>
  <manifest>
    <item id="ch" href="ch.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch"/>
  </spine>
</package>`,
    'EPUB/ch.xhtml':
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>chapter</p></body></html>',
  });
}

function zipStore(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameB = encoder.encode(name);
    const data = encoder.encode(text);
    const local = new Uint8Array(30 + nameB.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameB.length, true);
    local.set(nameB, 30);
    local.set(data, 30 + nameB.length);
    locals.push(local);

    const central = new Uint8Array(46 + nameB.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameB.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameB, 46);
    centrals.push(central);
    offset += local.length;
  }
  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, locals.length, true);
  ev.setUint16(10, locals.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + eocd.length);
  let w = 0;
  for (const chunk of locals) {
    out.set(chunk, w);
    w += chunk.length;
  }
  for (const chunk of centrals) {
    out.set(chunk, w);
    w += chunk.length;
  }
  out.set(eocd, w);
  return out;
}
