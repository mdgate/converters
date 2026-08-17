import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { latex, toMarkdown } from '../src/index.js';

const enc = new TextEncoder();

const SAMPLE = `\\documentclass{article}
\\usepackage{graphicx}
\\title{Hello}
\\author{Ada}
\\begin{document}
\\maketitle
\\section{Intro}
Hello \\textbf{world} and \\textit{friends} and \\emph{you} and \\texttt{code}.
\\subsection{More}
\\subsubsection{Deep}
\\begin{itemize}
\\item One
\\item Two
\\end{itemize}
\\begin{enumerate}
\\item First
\\end{enumerate}
\\begin{quote}
Quoted
\\end{quote}
\\begin{verbatim}
code
\\end{verbatim}
\\begin{lstlisting}[language=Python]
print(1)
\\end{lstlisting}
\\begin{minted}{js}
ok()
\\end{minted}
\\begin{tabular}{ll}
Name & Age \\\\
Ada & 36
\\end{tabular}
Math $x^2$ here.
\\[E=mc^2\\]
Kept \\unknown{text}.
\\end{document}
`;

describe('latex', () => {
  it('sniffs content, extension, and unrelated bytes', () => {
    const converter = latex();
    expect(converter.id).toBe('latex');
    expect(converter.sniff(enc.encode('\\documentclass{article}\n'))).toBe(2);
    expect(converter.sniff(enc.encode('\\begin{document}\n'))).toBe(2);
    expect(converter.sniff(enc.encode('  \\documentclass{article}\n'))).toBe(2);
    expect(converter.sniff(enc.encode('% comment\n\\documentclass{article}\n'))).toBe(2);
    expect(converter.sniff(enc.encode('% just a comment\n'))).toBe(2);
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('% tex\n')]);
    expect(converter.sniff(bom)).toBe(2);
    expect(converter.sniff(enc.encode('  % leading\n\\begin{document}\n'))).toBe(2);
    expect(converter.sniff(new Uint8Array([1]), { path: 'paper.tex' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'Paper.TEX' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'notes.latex' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'frag.ltx' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'notes.txt' })).toBe(0);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
    expect(converter.sniff(enc.encode('hello world'))).toBe(0);
    expect(converter.sniff(enc.encode('%PDF-1.7\n'))).toBe(0);
    expect(converter.sniff(enc.encode('%PDF-1.7\n'), { path: 'a.tex' })).toBe(0);
  });

  it('converts title, sections, lists, quote, verbatim, table, and math', async () => {
    await expect(toMarkdown(enc.encode(SAMPLE))).resolves.toBe(
      [
        '# Hello',
        '',
        'Ada',
        '',
        '## Intro',
        '',
        'Hello **world** and *friends* and *you* and `code`.',
        '',
        '### More',
        '',
        '#### Deep',
        '',
        '- One',
        '- Two',
        '',
        '1. First',
        '',
        '> Quoted',
        '',
        '```',
        'code',
        '```',
        '',
        '```python',
        'print(1)',
        '```',
        '',
        '```js',
        'ok()',
        '```',
        '',
        '| Name | Age |',
        '| --- | --- |',
        '| Ada | 36 |',
        '',
        'Math $x^2$ here.',
        '',
        '$$E=mc^2$$',
        '',
        'Kept text.',
        '',
      ].join('\n'),
    );
  });

  it('refuses a PDF or office file', async () => {
    await expect(toMarkdown(enc.encode('%PDF-1.7\n'), { path: 'x.tex' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    expect(() => latex().convert(enc.encode('%PDF-1.4\n'))).toThrow(ConvertError);
    expect(() => latex().convert(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toThrow(ConvertError);
    expect(() =>
      latex().convert(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
    ).toThrow(ConvertError);
  });
});
