import { ConvertError, create, pdf, toMarkdown } from '@mdgate/converters';
import { describe, expect, it } from 'vitest';

describe('toMarkdown', () => {
  it('throws unsupported for unrecognized content and extension', async () => {
    try {
      await toMarkdown(new TextEncoder().encode('hello'), { path: 'notes.txt' });
      throw new Error('expected unsupported');
    } catch (err) {
      expect(err).toBeInstanceOf(ConvertError);
      expect((err as ConvertError).code).toBe('unsupported');
      expect((err as ConvertError).message).toContain('unrecognized file content and extension');
    }
  });

  it('detects pdf from bytes and routes around the document model', async () => {
    try {
      await toMarkdown(new TextEncoder().encode('%PDF-1.7\n'), { path: 'scan.bin' });
      throw new Error('expected ConvertError');
    } catch (err) {
      expect(err).toBeInstanceOf(ConvertError);
      const code = (err as ConvertError).code;
      expect(code === 'malformed' || code === 'unsupported').toBe(true);
    }
  });

  it('falls back to the extension for signature-less csv', async () => {
    const md = await toMarkdown(new TextEncoder().encode('a,b\n1,2\n'), { path: 'sheet.csv' });
    expect(md).toContain('| a | b |');
    expect(md).toContain('| 1 | 2 |');
  });

  it('does not convert office files when only the pdf converter is installed', async () => {
    const convert = create([pdf()]);
    await expect(
      convert(new TextEncoder().encode('a,b\n1,2\n'), { path: 'sheet.csv' }),
    ).rejects.toBeInstanceOf(ConvertError);
  });
});
