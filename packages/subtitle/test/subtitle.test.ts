import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { subtitle, toMarkdown } from '../src/index.js';

const enc = new TextEncoder();

const SRT = `1
00:00:01,000 --> 00:00:04,000
Hello
world

2
00:00:05,000 --> 00:00:06,500
{\\an8}<c>Next</c> line
`;

const VTT = `WEBVTT

00:00:01.000 --> 00:00:04.000
Hello
world

cue-2
00:00:05.000 --> 00:00:06.500 align:start position:0%
{\\an8}<c>Next</c> line
`;

describe('subtitle', () => {
  it('sniffs content, extension, and unrelated bytes', () => {
    const converter = subtitle();
    expect(converter.id).toBe('subtitle');
    expect(converter.sniff(enc.encode('[Script Info]\nTitle: x\n'))).toBe(3);
    expect(converter.sniff(enc.encode('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi\n'))).toBe(2);
    expect(converter.sniff(enc.encode('WEBVTT - captions\n'))).toBe(2);
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('WEBVTT\n')]);
    expect(converter.sniff(bom)).toBe(2);
    expect(converter.sniff(enc.encode(SRT))).toBe(0);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.srt' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'track.vtt' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'captions.webvtt' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'clip.ass' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'clip.ssa' })).toBe(1);
    expect(converter.sniff(enc.encode('[ti:Demo]\n[00:01.00]Hi\n'))).toBe(2);
    expect(converter.sniff(enc.encode('{0}{25}Hello\n'))).toBe(2);
    expect(converter.sniff(enc.encode('[0][12]Foo|bar|bla\n'))).toBe(2);
    expect(converter.sniff(enc.encode('[41][] /italic\n'))).toBe(2);
    expect(converter.sniff(enc.encode('0:00:01.000,0:00:04.000\nHi\n'))).toBe(2);
    expect(
      converter.sniff(enc.encode('<tt xmlns="http://www.w3.org/ns/ttml"><p begin="0">x</p></tt>')),
    ).toBe(2);
    expect(converter.sniff(enc.encode('#\n0:00:01.00 0:00:04.00 VM Hi\n'))).toBe(2);
    expect(converter.sniff(new Uint8Array([1]), { path: 'clip.lrc' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'clip.sbv' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'clip.ttml' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'clip.jss' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
    expect(converter.sniff(enc.encode('hello'), { path: 'note.txt' })).toBe(0);
    expect(converter.sniff(enc.encode('[true, false]\n'))).toBe(0);
  });

  it('converts SRT and WebVTT cues to paragraphs', async () => {
    const expected = '*\\[00:00:01.000]* Hello world\n\n*\\[00:00:05.000]* Next line\n';
    await expect(toMarkdown(enc.encode(VTT))).resolves.toBe(expected);
    await expect(toMarkdown(enc.encode(SRT), { path: 'clip.srt' })).resolves.toBe(expected);
  });

  it('converts ASS dialogue text', async () => {
    const ass = `[Script Info]
Title: test

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,Hello{\\i1} world
Dialogue: 0,0:00:05.00,0:00:06.50,Default,,0,0,0,,Next\\Nline
`;
    await expect(toMarkdown(enc.encode(ass))).resolves.toBe(
      '*\\[00:00:01.000]* Hello world\n\n*\\[00:00:05.000]* Next line\n',
    );
  });

  it('converts LRC, MicroDVD, SBV, TTML, and JACOsub cues', async () => {
    await expect(
      toMarkdown(enc.encode('[ti:Demo]\n[00:01.00]Hello\n[01:02.50]World\n')),
    ).resolves.toBe('*\\[00:00:01.000]* Hello\n\n*\\[00:01:02.500]* World\n');
    await expect(
      toMarkdown(enc.encode('{0}{}25.000 FPS\n{25}{50}Hello\n{50}{75}foo|bar\n')),
    ).resolves.toBe('*\\[00:00:01.000]* Hello\n\n*\\[00:00:02.000]* foo bar\n');
    await expect(
      toMarkdown(
        enc.encode('0:00:01.000,0:00:04.000\nHello\nworld\n\n0:00:05.500,0:00:08.200\nNext\n'),
      ),
    ).resolves.toBe('*\\[00:00:01.000]* Hello world\n\n*\\[00:00:05.500]* Next\n');
    const ttml = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <head><metadata><ttm:title>Titre test</ttm:title></metadata></head>
  <body>
    <p begin="00:00:01.000">Hello</p>
    <p begin="00:00:05.500">Next<br/>line</p>
  </body>
</tt>
`;
    await expect(toMarkdown(enc.encode(ttml))).resolves.toBe(
      '# Titre test\n\n*\\[00:00:01.000]* Hello\n\n*\\[00:00:05.500]* Next line\n',
    );
    await expect(
      toMarkdown(
        enc.encode('#\n0:00:01.00 0:00:04.00 VM Hello\n0:00:05.00 0:00:06.50 vt Next\\nline\n'),
      ),
    ).resolves.toBe('*\\[00:00:01.000]* Hello\n\n*\\[00:00:05.000]* Next line\n');
    await expect(toMarkdown(enc.encode('[00:01.00][00:02.00]Chorus\n'))).resolves.toBe(
      '*\\[00:00:01.000]* Chorus\n\n*\\[00:00:02.000]* Chorus\n',
    );
    await expect(
      toMarkdown(enc.encode('[0][12]Foo|bar|bla\n[41][] /italic|\\bold|\\/italicbold\n')),
    ).resolves.toBe(
      '*\\[00:00:00.000]* Foo bar bla\n\n*\\[00:00:04.100]* italic bold italicbold\n',
    );
    const entities = `<?xml version="1.0"?>
<tt xmlns="http://www.w3.org/ns/ttml">
  <body><p begin="00:00:01.000">A &amp; B&#39;s</p></body>
</tt>
`;
    await expect(toMarkdown(enc.encode(entities))).resolves.toBe("*\\[00:00:01.000]* A & B's\n");
  });

  it('refuses a PDF and office file', async () => {
    await expect(toMarkdown(enc.encode('%PDF-1.7\n'), { path: 'x.srt' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    expect(() => subtitle().convert(enc.encode('%PDF-1.4\n'))).toThrow(ConvertError);
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 1]);
    expect(() => subtitle().convert(ole, { path: 'x.srt' })).toThrow(ConvertError);
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 1]);
    expect(() => subtitle().convert(zip, { path: 'x.vtt' })).toThrow(ConvertError);
  });
});
