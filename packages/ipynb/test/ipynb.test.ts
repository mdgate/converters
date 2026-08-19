import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { ipynb, toMarkdown } from '../src/index.js';

const enc = new TextEncoder();

function notebook(cells: unknown[], metadata?: Record<string, unknown>): Uint8Array {
  return enc.encode(
    JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: metadata ?? {
        language_info: { name: 'python' },
        kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      },
      cells,
    }),
  );
}

describe('ipynb', () => {
  it('sniffs content, extension, and unrelated bytes', () => {
    const converter = ipynb();
    expect(converter.id).toBe('ipynb');
    expect(converter.sniff(notebook([{ cell_type: 'markdown', source: 'Hi', metadata: {} }]))).toBe(
      3,
    );
    expect(converter.sniff(new Uint8Array([1]), { path: 'note.ipynb' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'Note.IPYNB' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'notes.txt' })).toBe(0);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
    expect(converter.sniff(enc.encode('%PDF-1.7\n'))).toBe(0);
    expect(converter.sniff(enc.encode('{"foo":1}'))).toBe(0);
    expect(converter.sniff(enc.encode('{"nbformat":4}'))).toBe(0);
  });

  it('converts markdown, code, and outputs', async () => {
    const bytes = notebook([
      { cell_type: 'markdown', metadata: {}, source: ['# Title\n', '\n', 'Hello notebook'] },
      {
        cell_type: 'code',
        metadata: {},
        source: ['print(1)\n'],
        outputs: [
          { output_type: 'stream', name: 'stdout', text: ['1\n'] },
          {
            output_type: 'execute_result',
            data: { 'text/markdown': ['**ok**'], 'text/plain': ['42'] },
            metadata: {},
          },
          {
            output_type: 'display_data',
            data: { 'image/png': 'iVBORw0KGgo=', 'text/plain': ['<Figure>'] },
            metadata: {},
          },
        ],
      },
    ]);
    const md = await toMarkdown(bytes);
    expect(md).toContain('# Title');
    expect(md).toContain('Hello notebook');
    expect(md).toContain('```python\nprint(1)\n```');
    expect(md).toContain('```\n1\n```');
    expect(md).toContain('**ok**');
    expect(md).toContain('```\n42\n```');
    expect(md).toContain('![image/png](image.png)');
  });

  it('uses kernelspec language when language_info is missing', async () => {
    const bytes = notebook([{ cell_type: 'code', metadata: {}, source: ['1 + 1'], outputs: [] }], {
      kernelspec: { language: 'r', name: 'ir' },
    });
    await expect(toMarkdown(bytes)).resolves.toContain('```r\n1 + 1\n```');
  });

  it('throws malformed on invalid JSON', async () => {
    await expect(toMarkdown(enc.encode('{not json'), { path: 'x.ipynb' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'malformed',
    });
  });

  it('refuses a PDF or office file', async () => {
    await expect(toMarkdown(enc.encode('%PDF-1.7\n'), { path: 'x.ipynb' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    expect(() => ipynb().convert(enc.encode('%PDF-1.4\n'))).toThrow(ConvertError);
    expect(() => ipynb().convert(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toThrow(ConvertError);
    expect(() =>
      ipynb().convert(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    ).toThrow(ConvertError);
  });
});
