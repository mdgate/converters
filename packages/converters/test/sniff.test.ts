import { create } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { data } from '../../data/src/index.js';
import { doc } from '../../doc/src/index.js';
import { email } from '../../email/src/index.js';
import { html } from '../../html/src/index.js';
import { svg } from '../../image/src/index.js';
import { ipynb } from '../../ipynb/src/index.js';
import { odf } from '../../odf/src/index.js';
import { subtitle } from '../../subtitle/src/index.js';
import { text } from '../../text/src/index.js';
import { zip } from '../../zip/src/index.js';

const enc = new TextEncoder();

describe('sniff routing', () => {
  const convert = create([data(), subtitle(), html(), email(), ipynb(), svg(), odf(), zip()]);

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
  });
});
