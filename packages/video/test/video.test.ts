import { create } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { toMarkdown, video } from '../src/index.js';

const enc = new TextEncoder();
const MP4 = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00,
]);
const ISOM = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00,
]);
const MOV = new Uint8Array([
  0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20, 0x00, 0x00, 0x00, 0x00,
]);
const M4V = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x56, 0x20, 0x00, 0x00, 0x00, 0x00,
]);
const M4A = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0x00, 0x00, 0x00, 0x00,
]);
const M4A_WITH_MP42 = new Uint8Array([
  0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0x00, 0x00, 0x00, 0x00,
  0x6d, 0x70, 0x34, 0x32,
]);
const HEIC = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00,
]);
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]);
const MKV = new Uint8Array([
  0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x82, 0x88, 0x6d, 0x61, 0x74, 0x72, 0x6f, 0x73, 0x6b, 0x61,
]);
const AVI = enc.encode('RIFF\x00\x00\x00\x00AVI ');
const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

describe('video', () => {
  it('sniffs magic and extensions', () => {
    const converter = video(async () => 'x');
    expect(converter.id).toBe('video');
    expect(converter.sniff(MP4)).toBe(2);
    expect(converter.sniff(ISOM)).toBe(2);
    expect(converter.sniff(MOV)).toBe(2);
    expect(converter.sniff(M4V)).toBe(2);
    expect(converter.sniff(WEBM)).toBe(2);
    expect(converter.sniff(MKV)).toBe(2);
    expect(converter.sniff(AVI)).toBe(2);
    expect(converter.sniff(M4A)).toBe(0);
    expect(converter.sniff(M4A_WITH_MP42)).toBe(0);
    expect(converter.sniff(HEIC)).toBe(0);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.mp4' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.m4v' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.mov' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.webm' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.mkv' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.avi' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'Clip.MP4' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
    expect(converter.sniff(new Uint8Array([1]), { path: 'notes.txt' })).toBe(0);
    expect(converter.sniff(enc.encode('%PDF-1.7\n'))).toBe(0);
  });

  it('converts through the registered function', async () => {
    const convert = create([video(async ({ mime }) => `got ${mime}`)]);
    await expect(convert(MP4)).resolves.toBe('got video/mp4\n');
    await expect(convert(ISOM)).resolves.toBe('got video/mp4\n');
    await expect(convert(MOV)).resolves.toBe('got video/quicktime\n');
    await expect(convert(M4V)).resolves.toBe('got video/mp4\n');
    await expect(convert(WEBM)).resolves.toBe('got video/webm\n');
    await expect(convert(MKV)).resolves.toBe('got video/x-matroska\n');
    await expect(convert(AVI)).resolves.toBe('got video/x-msvideo\n');
    await expect(convert(new Uint8Array([1]), { path: 'clip.mp4' })).resolves.toBe(
      'got video/mp4\n',
    );
  });

  it('keeps an existing trailing newline from the callback', async () => {
    const convert = create([video(async () => 'hello\n')]);
    await expect(convert(MP4)).resolves.toBe('hello\n');
  });

  it('throws without a conversion callback or on unknown mime', async () => {
    await expect(video().convert(MP4)).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    await expect(toMarkdown(MP4)).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    await expect(video(async () => 'x').convert(new Uint8Array([1]))).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
  });

  it('refuses a PDF/office file and leaves audio-only MP4 alone', async () => {
    const converter = video(async () => 'x');
    await expect(converter.convert(enc.encode('%PDF-1.7\n'))).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    await expect(converter.convert(OLE, { path: 'clip.mp4' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    await expect(converter.convert(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).rejects.toMatchObject(
      {
        name: 'ConvertError',
        code: 'unsupported',
      },
    );
    await expect(converter.convert(M4A)).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
  });
});
