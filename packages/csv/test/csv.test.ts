import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { csv, toMarkdown } from '../src/index.js';

const enc = new TextEncoder();

describe('csv', () => {
  it('sniffs extension hints and unrelated bytes', () => {
    const converter = csv();
    expect(converter.id).toBe('csv');
    expect(converter.sniff(enc.encode('a,b\n1,2\n'))).toBe(0);
    expect(converter.sniff(new Uint8Array([1]), { path: 'sheet.csv' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'sheet.tsv' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'sheet.tab' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'Sheet.TSV' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'notes.txt' })).toBe(0);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
    expect(converter.sniff(enc.encode('%PDF-1.7\n'))).toBe(0);
  });

  it('converts a tab-separated file with path sheet.tsv to a markdown table', async () => {
    const bytes = enc.encode('name\tage\nAda\t36\n');
    await expect(toMarkdown(bytes, { path: 'sheet.tsv' })).resolves.toBe(
      '| name | age |\n| --- | --- |\n| Ada | 36 |\n',
    );
  });

  it('refuses a PDF or office file', async () => {
    await expect(toMarkdown(enc.encode('%PDF-1.7\n'), { path: 'x.csv' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    expect(() => csv().convert(enc.encode('%PDF-1.4\n'))).toThrow(ConvertError);
    expect(() => csv().convert(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toThrow(ConvertError);
    expect(() =>
      csv().convert(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    ).toThrow(ConvertError);
  });
});
