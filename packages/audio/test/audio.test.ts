import { create } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { audio, toMarkdown } from '../src/index.js';

const enc = new TextEncoder();
const ID3 = enc.encode('ID3\x04\x00\x00');
const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x00]);
const WAV = enc.encode('RIFF\x00\x00\x00\x00WAVE');
const M4A = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0x00, 0x00, 0x00, 0x00,
]);
const MP4 = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32, 0x00, 0x00, 0x00, 0x00,
]);
const OGG = enc.encode('OggS');
const FLAC = enc.encode('fLaC');
const OLE = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

describe('audio', () => {
  it('sniffs magic and extensions', () => {
    const converter = audio(async () => 'x');
    expect(converter.id).toBe('audio');
    expect(converter.sniff(ID3)).toBe(2);
    expect(converter.sniff(MP3)).toBe(2);
    expect(converter.sniff(WAV)).toBe(2);
    expect(converter.sniff(M4A)).toBe(2);
    expect(converter.sniff(MP4)).toBe(0);
    expect(converter.sniff(OGG)).toBe(2);
    expect(converter.sniff(FLAC)).toBe(2);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.mp3' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.wav' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.wave' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.m4a' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.aac' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.ogg' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.flac' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'a.weba' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'Track.MP3' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
    expect(converter.sniff(new Uint8Array([1]), { path: 'notes.txt' })).toBe(0);
    expect(converter.sniff(enc.encode('%PDF-1.7\n'))).toBe(0);
  });

  it('converts through the registered function', async () => {
    const convert = create([audio(async ({ mime }) => `got ${mime}`)]);
    await expect(convert(ID3)).resolves.toBe('got audio/mpeg\n');
    await expect(convert(MP3)).resolves.toBe('got audio/mpeg\n');
    await expect(convert(WAV)).resolves.toBe('got audio/wav\n');
    await expect(convert(M4A)).resolves.toBe('got audio/m4a\n');
    await expect(convert(OGG)).resolves.toBe('got audio/ogg\n');
    await expect(convert(FLAC)).resolves.toBe('got audio/flac\n');
    await expect(convert(new Uint8Array([1]), { path: 'clip.aac' })).resolves.toBe(
      'got audio/aac\n',
    );
    await expect(convert(new Uint8Array([1]), { path: 'clip.weba' })).resolves.toBe(
      'got audio/webm\n',
    );
    await expect(convert(new Uint8Array([1]), { path: 'clip.wave' })).resolves.toBe(
      'got audio/x-wav\n',
    );
  });

  it('keeps an existing trailing newline from the callback', async () => {
    const convert = create([audio(async () => 'hello\n')]);
    await expect(convert(MP3)).resolves.toBe('hello\n');
  });

  it('throws without a transcription callback or on unknown mime', async () => {
    await expect(audio().convert(MP3)).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    await expect(toMarkdown(MP3)).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    await expect(audio(async () => 'x').convert(new Uint8Array([1]))).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
  });

  it('refuses a PDF/office file', async () => {
    const converter = audio(async () => 'x');
    await expect(converter.convert(enc.encode('%PDF-1.7\n'))).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    await expect(converter.convert(OLE, { path: 'clip.mp3' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    await expect(converter.convert(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).rejects.toMatchObject(
      {
        name: 'ConvertError',
        code: 'unsupported',
      },
    );
  });
});
