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
    expect(converter.sniff(enc.encode('WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi\n'))).toBe(2);
    expect(converter.sniff(enc.encode('WEBVTT - captions\n'))).toBe(2);
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('WEBVTT\n')]);
    expect(converter.sniff(bom)).toBe(2);
    expect(converter.sniff(enc.encode(SRT))).toBe(0);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.srt' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'track.vtt' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'captions.webvtt' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
    expect(converter.sniff(enc.encode('hello'), { path: 'note.txt' })).toBe(0);
  });

  it('converts SRT and WebVTT cues to paragraphs', async () => {
    const expected = '*\\[00:00:01.000]* Hello world\n\n*\\[00:00:05.000]* Next line\n';
    await expect(toMarkdown(enc.encode(VTT))).resolves.toBe(expected);
    await expect(toMarkdown(enc.encode(SRT), { path: 'clip.srt' })).resolves.toBe(expected);
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
