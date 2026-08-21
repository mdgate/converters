import { describe, expect, it } from 'vitest';
import {
  type Block,
  type Cell,
  cellFromInlines,
  cellSpanning,
  type Document,
  emptyCell,
  GridBuilder,
  heading,
  type Inline,
  type List,
  type ListItem,
  type Note,
  newCell,
  plain,
  type Style,
  tableFromRows,
} from '../src/model/index.js';
import { documentToMarkdown, gfmSlug } from '../src/render/index.js';

function doc(blocks: Block[]): string {
  return documentToMarkdown({ blocks, notes: [], assets: [] });
}

function styled(text: string, style: Style): Inline {
  return { type: 'text', text, style };
}

function tableFrom(rows: Cell[][], headerRows: number): Block {
  return { type: 'table', table: tableFromRows(rows, headerRows, 'data') };
}

const BOLD: Style = { bold: true, italic: false, strike: false, code: false };
const ITALIC: Style = { bold: false, italic: true, strike: false, code: false };
const PLAIN: Style = { bold: false, italic: false, strike: false, code: false };

describe('documentToMarkdown', () => {
  it('heading and paragraph', () => {
    const md = doc([
      heading(2, [plain('Title')]),
      { type: 'paragraph', inlines: [plain('Hello world.')] },
    ]);
    expect(md).toBe('## Title\n\nHello world.\n');
  });

  it('escapes paired syntax chars', () => {
    expect(doc([{ type: 'paragraph', inlines: [plain('a *bold* _it_ ~st~ `code`')] }])).toBe(
      'a \\*bold* \\_it_ \\~st~ \\`code`\n',
    );
    expect(doc([{ type: 'paragraph', inlines: [plain('see [really] and <b>hi</b>')] }])).toBe(
      'see \\[really] and \\<b>hi\\</b>\n',
    );
  });

  it('leaves lone syntax chars alone', () => {
    expect(doc([{ type: 'paragraph', inlines: [plain('2 * 3 = 6 and 5*6 #tag')] }])).toBe(
      '2 * 3 = 6 and 5*6 #tag\n',
    );
    expect(doc([{ type: 'paragraph', inlines: [plain('x < 5, ~10%, file_name, a[1')] }])).toBe(
      'x < 5, ~10%, file_name, a[1\n',
    );
  });

  it('leaves intraword underscores unescaped', () => {
    expect(doc([{ type: 'paragraph', inlines: [plain('snake_case_name vs _lead_')] }])).toBe(
      'snake_case_name vs \\_lead_\n',
    );
  });

  it('escapes line-start-only chars', () => {
    expect(doc([{ type: 'paragraph', inlines: [plain('- not a list')] }])).toBe('\\- not a list\n');
    expect(doc([{ type: 'paragraph', inlines: [plain('1. not a list')] }])).toBe(
      '1\\. not a list\n',
    );
    expect(doc([{ type: 'paragraph', inlines: [plain('take 2. then rest')] }])).toBe(
      'take 2. then rest\n',
    );
  });

  it('does not escape line-start lookalikes', () => {
    expect(doc([{ type: 'paragraph', inlines: [plain('-5°C at dawn')] }])).toBe('-5°C at dawn\n');
    expect(doc([{ type: 'paragraph', inlines: [plain('1.5 million users')] }])).toBe(
      '1.5 million users\n',
    );
    expect(doc([{ type: 'paragraph', inlines: [plain('#hashtag first')] }])).toBe(
      '#hashtag first\n',
    );
    expect(doc([{ type: 'paragraph', inlines: [plain('--- ruled')] }])).toBe('--- ruled\n');
    expect(doc([{ type: 'paragraph', inlines: [plain('---')] }])).toBe('\\---\n');
  });

  it('does not escape a negative number in a cell', () => {
    const md = doc([
      tableFrom([[cellFromInlines([plain('-42')]), cellFromInlines([plain('x')])]], 0),
    ]);
    expect(md).toBe('|  |  |\n| --- | --- |\n| -42 | x |\n');
  });

  it('escapes a trailing delimiter before a styled run', () => {
    expect(doc([{ type: 'paragraph', inlines: [plain('star*'), styled('x', BOLD)] }])).toBe(
      'star\\***x**\n',
    );
  });

  it('moves bold trailing space out', () => {
    expect(doc([{ type: 'paragraph', inlines: [styled('bold ', BOLD), plain('plain')] }])).toBe(
      '**bold** plain\n',
    );
  });

  it('merges adjacent same-style runs', () => {
    expect(doc([{ type: 'paragraph', inlines: [styled('bo', BOLD), styled('ld', BOLD)] }])).toBe(
      '**bold**\n',
    );
  });

  it('renders bold+italic combo', () => {
    expect(
      doc([
        {
          type: 'paragraph',
          inlines: [styled('both', { bold: true, italic: true, strike: false, code: false })],
        },
      ]),
    ).toBe('***both***\n');
  });

  it('strips styling from a whitespace-only run and bridges', () => {
    expect(
      doc([
        {
          type: 'paragraph',
          inlines: [styled('a', BOLD), styled(' ', ITALIC), styled('b', BOLD)],
        },
      ]),
    ).toBe('**a b**\n');
  });

  it('renders links', () => {
    expect(
      doc([
        {
          type: 'paragraph',
          inlines: [
            {
              type: 'link',
              content: [plain('site')],
              target: { type: 'external', url: 'https://example.com/a(b)' },
            },
          ],
        },
      ]),
    ).toBe('[site](<https://example.com/a(b)>)\n');
  });

  it('preserves relative links', () => {
    expect(
      doc([
        {
          type: 'paragraph',
          inlines: [
            {
              type: 'link',
              content: [plain('next')],
              target: { type: 'relative', url: 'chapter2.xhtml' },
            },
          ],
        },
      ]),
    ).toBe('[next](chapter2.xhtml)\n');
    expect(
      doc([
        {
          type: 'paragraph',
          inlines: [
            {
              type: 'link',
              content: [plain('mail')],
              target: { type: 'external', url: 'mailto:a@b.c' },
            },
          ],
        },
      ]),
    ).toBe('[mail](mailto:a@b.c)\n');
  });

  it('degrades an unresolved anchor to text', () => {
    expect(
      doc([
        {
          type: 'paragraph',
          inlines: [
            { type: 'link', content: [plain('note')], target: { type: 'anchor', id: 'nowhere' } },
          ],
        },
      ]),
    ).toBe('note\n');
  });

  it('renders sourceless image alt text', () => {
    expect(
      doc([
        {
          type: 'paragraph',
          inlines: [{ type: 'image', alt: 'chart', source: { type: 'unavailable' } }],
        },
      ]),
    ).toBe('chart\n');
  });

  it('renders an embedded image with empty alt as a picture when it is the only content', () => {
    expect(
      documentToMarkdown({
        blocks: [
          {
            type: 'paragraph',
            inlines: [{ type: 'image', alt: '', source: { type: 'asset', id: 0 } }],
          },
        ],
        notes: [],
        assets: [
          { id: 0, mediaType: 'image/jpeg', originPart: 'pic.jpg', bytes: new Uint8Array() },
        ],
      }),
    ).toBe('![]()\n');
  });

  it('emits unused image assets', () => {
    expect(
      documentToMarkdown({
        blocks: [],
        notes: [],
        assets: [
          { id: 0, mediaType: 'image/jpeg', originPart: 'a.jpg', bytes: new Uint8Array() },
          { id: 1, mediaType: 'image/png', originPart: 'b.png', bytes: new Uint8Array() },
        ],
      }),
    ).toBe('![]()\n\n![]()\n');
  });

  it('escapes composite marker labels', () => {
    const list: List = {
      marker: 'decimal',
      start: 1,
      items: [
        {
          blocks: [{ type: 'paragraph', inlines: [plain('x')] }],
          checked: undefined,
          markerLabel: '#1\n*a*',
        },
      ],
    };
    const md = doc([{ type: 'list', list }]);
    expect(md.split('\n').filter((l) => l.length > 0).length).toBe(1);
    expect(md).not.toContain('*a*');
    expect(md.startsWith('- ')).toBe(true);
  });

  it('unwraps a trivial layout table', () => {
    const b = new GridBuilder();
    b.nextRow();
    b.place(
      newCell([heading(1, [plain('Boxed')]), { type: 'paragraph', inlines: [plain('body')] }]),
    );
    expect(doc([{ type: 'table', table: b.finish('layout') }])).toBe('# Boxed\n\nbody\n');
  });

  it('does not unwrap a 1x1 data table', () => {
    expect(doc([tableFrom([[cellFromInlines([plain('x')])]], 0)])).toBe('|  |\n| --- |\n| x |\n');
  });

  it('trims trailing empty rows and columns', () => {
    const md = doc([
      tableFrom(
        [
          [cellFromInlines([plain('a')]), cellFromInlines([plain('b')]), emptyCell()],
          [cellFromInlines([plain('c')]), emptyCell(), emptyCell()],
          [emptyCell(), emptyCell(), emptyCell()],
        ],
        1,
      ),
    ]);
    expect(md).toBe('| a | b |\n| --- | --- |\n| c |  |\n');
  });

  it('renders a basic table', () => {
    const md = doc([
      tableFrom(
        [
          [cellFromInlines([plain('Name')]), cellFromInlines([plain('Age')])],
          [cellFromInlines([plain('Ann | Bob')]), cellFromInlines([plain('30')])],
        ],
        1,
      ),
    ]);
    expect(md).toBe('| Name | Age |\n| --- | --- |\n| Ann \\| Bob | 30 |\n');
  });

  it('renders a headerless ragged table', () => {
    const md = doc([
      tableFrom(
        [
          [cellFromInlines([plain('a')])],
          [cellFromInlines([plain('b')]), cellFromInlines([plain('c')])],
        ],
        0,
      ),
    ]);
    expect(md).toBe('|  |  |\n| --- | --- |\n| a |  |\n| b | c |\n');
  });

  it('joins multiparagraph cells with br', () => {
    const cell = newCell([
      { type: 'paragraph', inlines: [plain('one')] },
      { type: 'paragraph', inlines: [plain('two')] },
    ]);
    const md = doc([tableFrom([[cell, cellFromInlines([plain('x')])]], 0)]);
    expect(md).toBe('|  |  |\n| --- | --- |\n| one<br>two | x |\n');
  });

  it('renders merged cells as blank covered positions', () => {
    const b = new GridBuilder();
    b.nextRow();
    b.place(cellSpanning([{ type: 'paragraph', inlines: [plain('wide')] }], 2, 1));
    b.place(cellFromInlines([plain('end')]));
    b.nextRow();
    for (const t of ['a', 'b', 'c']) b.place(cellFromInlines([plain(t)]));
    const table = b.finish('data');
    table.headerRows = 1;
    expect(doc([{ type: 'table', table }])).toBe(
      '| wide |  | end |\n| --- | --- | --- |\n| a | b | c |\n',
    );
  });

  it('preserves trailing covered columns', () => {
    const b = new GridBuilder();
    b.nextRow();
    b.place(cellSpanning([{ type: 'paragraph', inlines: [plain('wide')] }], 3, 1));
    const table = b.finish('data');
    table.headerRows = 1;
    expect(doc([{ type: 'table', table }])).toBe('| wide |  |  |\n| --- | --- | --- |\n');
  });

  it('encodes url pipes so they cannot split table cells', () => {
    const cell = cellFromInlines([
      { type: 'link', content: [], target: { type: 'external', url: 'https://e.test/a|b' } },
    ]);
    expect(doc([tableFrom([[cell]], 0)])).toBe(
      '|  |\n| --- |\n| [https://e.test/a\\|b](https://e.test/a%7Cb) |\n',
    );
  });

  it('encodes url angle brackets without bracketing', () => {
    expect(
      doc([
        {
          type: 'paragraph',
          inlines: [
            {
              type: 'link',
              content: [plain('link')],
              target: { type: 'external', url: 'https://e.test/a<b>c' },
            },
          ],
        },
      ]),
    ).toBe('[link](https://e.test/a%3Cb%3Ec)\n');
  });

  it('encodes url controls so they cannot split the document', () => {
    expect(
      doc([
        {
          type: 'paragraph',
          inlines: [
            {
              type: 'link',
              content: [plain('link')],
              target: { type: 'external', url: 'https://e.test/a\nb' },
            },
          ],
        },
      ]),
    ).toBe('[link](https://e.test/a%0Ab)\n');
  });

  it('renders a nested list', () => {
    const item = (text: string): ListItem => ({
      blocks: [{ type: 'paragraph', inlines: [plain(text)] }],
      checked: undefined,
      markerLabel: undefined,
    });
    const md = doc([
      {
        type: 'list',
        list: {
          marker: 'bullet',
          start: 1,
          items: [
            {
              blocks: [
                { type: 'paragraph', inlines: [plain('outer')] },
                { type: 'list', list: { marker: 'decimal', start: 3, items: [item('inner')] } },
              ],
              checked: undefined,
              markerLabel: undefined,
            },
          ],
        },
      },
    ]);
    expect(md).toBe('- outer\n\n  3. inner\n');
  });

  it('renders roman and alpha markers literally', () => {
    const item = (text: string): ListItem => ({
      blocks: [{ type: 'paragraph', inlines: [plain(text)] }],
      checked: undefined,
      markerLabel: undefined,
    });
    const md = doc([
      {
        type: 'list',
        list: { marker: 'lowerRoman', start: 3, items: [item('third'), item('fourth')] },
      },
      {
        type: 'list',
        list: { marker: 'upperAlpha', start: 27, items: [item('double letters')] },
      },
    ]);
    expect(md).toBe('- iii. third\n- iv. fourth\n\n- AA. double letters\n');
  });

  it('fences a code span that contains backticks', () => {
    expect(
      doc([
        {
          type: 'paragraph',
          inlines: [styled('a`b', { ...PLAIN, code: true })],
        },
      ]),
    ).toBe('``a`b``\n');
  });

  it('renders a hard break', () => {
    expect(
      doc([
        {
          type: 'paragraph',
          inlines: [plain('line one'), { type: 'lineBreak' }, plain('line two')],
        },
      ]),
    ).toBe('line one\\\nline two\n');
  });

  it('escapes line-start syntax after a hard break', () => {
    expect(
      doc([
        {
          type: 'paragraph',
          inlines: [plain('intro'), { type: 'lineBreak' }, plain('- dash')],
        },
      ]),
    ).toBe('intro\\\n\\- dash\n');
  });

  it('renders a blockquote', () => {
    expect(
      doc([{ type: 'blockQuote', blocks: [{ type: 'paragraph', inlines: [plain('quoted')] }] }]),
    ).toBe('> quoted\n');
  });

  it('drops empty paragraphs', () => {
    expect(
      doc([
        { type: 'paragraph', inlines: [plain('  ')] },
        { type: 'paragraph', inlines: [] },
        { type: 'paragraph', inlines: [plain('real')] },
      ]),
    ).toBe('real\n');
  });

  it('escapes entities but keeps a plain ampersand', () => {
    expect(doc([{ type: 'paragraph', inlines: [plain('A & B &amp; C')] }])).toBe(
      'A & B &amp;amp; C\n',
    );
  });

  it('numbers footnotes in first-reference order', () => {
    const note = (id: string, blocks: Block[]): Note => ({
      id,
      kind: 'footnote',
      blocks,
    });
    const md = documentToMarkdown({
      blocks: [
        {
          type: 'paragraph',
          inlines: [
            plain('Claim.'),
            { type: 'noteRef', id: 'b' },
            plain(' More.'),
            { type: 'noteRef', id: 'a' },
          ],
        },
      ],
      notes: [
        note('a', [{ type: 'paragraph', inlines: [plain('Second note.')] }]),
        note('b', [
          { type: 'paragraph', inlines: [plain('First note.')] },
          { type: 'paragraph', inlines: [plain('With a second paragraph.')] },
        ]),
      ],
      assets: [],
    });
    expect(md).toBe(
      'Claim.[^1] More.[^2]\n\n[^1]: First note.\n\n    With a second paragraph.\n\n[^2]: Second note.\n',
    );
  });

  it('keeps unreferenced notes and drops empty ones', () => {
    const note = (id: string, blocks: Block[]): Note => ({ id, kind: 'footnote', blocks });
    const md = documentToMarkdown({
      blocks: [
        {
          type: 'paragraph',
          inlines: [plain('Text'), { type: 'noteRef', id: 'empty' }],
        },
      ],
      notes: [
        note('empty', [{ type: 'paragraph', inlines: [] }]),
        note('orphan', [{ type: 'paragraph', inlines: [plain('Kept.')] }]),
      ],
      assets: [],
    } satisfies Document);
    expect(md).toBe('Text\n\n[^1]: Kept.\n');
  });

  it('renders one definition for a duplicate note id', () => {
    const note = (id: string, blocks: Block[]): Note => ({ id, kind: 'footnote', blocks });
    const md = documentToMarkdown({
      blocks: [{ type: 'paragraph', inlines: [plain('Text'), { type: 'noteRef', id: 'a' }] }],
      notes: [
        note('a', [{ type: 'paragraph', inlines: [plain('First wins.')] }]),
        note('a', [{ type: 'paragraph', inlines: [plain('Duplicate dropped.')] }]),
      ],
      assets: [],
    });
    expect(md).toBe('Text[^1]\n\n[^1]: First wins.\n');
  });

  it('does not let a blank duplicate suppress a later definition', () => {
    const note = (id: string, blocks: Block[]): Note => ({ id, kind: 'footnote', blocks });
    const md = documentToMarkdown({
      blocks: [{ type: 'paragraph', inlines: [plain('Text'), { type: 'noteRef', id: 'a' }] }],
      notes: [
        note('a', [{ type: 'paragraph', inlines: [] }]),
        note('a', [{ type: 'paragraph', inlines: [plain('Usable.')] }]),
      ],
      assets: [],
    });
    expect(md).toBe('Text[^1]\n\n[^1]: Usable.\n');
  });

  it('keeps an empty list item and its numbering', () => {
    const item = (text: string): ListItem => ({
      blocks: text.length === 0 ? [] : [{ type: 'paragraph', inlines: [plain(text)] }],
      checked: undefined,
      markerLabel: undefined,
    });
    expect(
      doc([
        {
          type: 'list',
          list: { marker: 'decimal', start: 1, items: [item('one'), item(''), item('three')] },
        },
      ]),
    ).toBe('1. one\n2. \n3. three\n');
  });

  it('renders a task list', () => {
    expect(
      doc([
        {
          type: 'list',
          list: {
            marker: 'bullet',
            start: 1,
            items: [
              {
                blocks: [{ type: 'paragraph', inlines: [plain('done')] }],
                checked: true,
                markerLabel: undefined,
              },
              {
                blocks: [{ type: 'paragraph', inlines: [plain('todo')] }],
                checked: false,
                markerLabel: undefined,
              },
            ],
          },
        },
      ]),
    ).toBe('- [x] done\n- [ ] todo\n');
  });

  it('escapes brackets in a link label', () => {
    expect(
      doc([
        {
          type: 'paragraph',
          inlines: [
            {
              type: 'link',
              content: [plain('x]')],
              target: { type: 'external', url: 'https://e.com' },
            },
          ],
        },
      ]),
    ).toBe('[x\\]](https://e.com)\n');
  });

  it('escapes brackets and backslash in image alt', () => {
    expect(
      doc([
        {
          type: 'paragraph',
          inlines: [
            {
              type: 'image',
              alt: 'a[b]c\\',
              source: { type: 'external', url: 'https://e.com/i.png' },
            },
          ],
        },
      ]),
    ).toBe('![a\\[b\\]c\\\\](https://e.com/i.png)\n');
  });

  it('round-trips an anchor on a plain paragraph', () => {
    const mark = 'My Mark';
    const md = doc([
      { type: 'paragraph', inlines: [{ type: 'anchor', id: mark }, plain('Target here.')] },
      {
        type: 'paragraph',
        inlines: [{ type: 'link', content: [plain('jump')], target: { type: 'anchor', id: mark } }],
      },
    ]);
    expect(md).toBe('<a id="my-mark"></a>Target here.\n\n[jump](#my-mark)\n');
  });

  it('renders nothing for an unreferenced anchor', () => {
    expect(
      doc([
        {
          type: 'paragraph',
          inlines: [{ type: 'anchor', id: 'standalone-mark' }, plain('No link points here.')],
        },
      ]),
    ).toBe('No link points here.\n');
  });

  it('uses the heading slug for a coincident anchor', () => {
    const md = doc([
      {
        type: 'heading',
        level: 2,
        anchor: 'bm1',
        content: [plain('Section Two')],
      },
      {
        type: 'paragraph',
        inlines: [{ type: 'link', content: [plain('go')], target: { type: 'anchor', id: 'bm1' } }],
      },
    ]);
    expect(md).toBe('## Section Two\n\n[go](#section-two)\n');
  });

  it('dedupes duplicate heading slugs', () => {
    const md = doc([
      heading(1, [plain('Same')]),
      { type: 'heading', level: 1, anchor: 'x', content: [plain('Same')] },
      {
        type: 'paragraph',
        inlines: [
          { type: 'link', content: [plain('second')], target: { type: 'anchor', id: 'x' } },
        ],
      },
    ]);
    expect(md).toBe('# Same\n\n# Same\n\n[second](#same-1)\n');
  });

  it('renders a code block in a cell as a code span', () => {
    const cell = newCell([{ type: 'codeBlock', lang: undefined, text: 'let `x` = 1;' }]);
    expect(doc([tableFrom([[cell]], 0)])).toBe('|  |\n| --- |\n| ``let `x` = 1;`` |\n');
  });

  it('keeps a code block language hint', () => {
    expect(doc([{ type: 'codeBlock', lang: 'rust', text: 'fn main() {}' }])).toBe(
      '```rust\nfn main() {}\n```\n',
    );
  });

  it('trims cell edge whitespace', () => {
    const md = doc([
      tableFrom([[cellFromInlines([plain('  padded\t')]), cellFromInlines([plain('plain')])]], 0),
    ]);
    expect(md).toBe('|  |  |\n| --- | --- |\n| padded | plain |\n');
  });
});

describe('gfmSlug', () => {
  it('keeps word-forming characters', () => {
    expect(gfmSlug('Hello World!')).toBe('hello-world');
    expect(gfmSlug('  leading and trailing  ')).toBe('leading-and-trailing');
    expect(gfmSlug('under_score and hy-phen')).toBe('under_score-and-hy-phen');
    expect(gfmSlug('C++ & Rust')).toBe('c--rust');
    expect(gfmSlug('étude précomposée')).toBe('étude-précomposée');
    expect(gfmSlug('combining n\u{0303} tilde')).toBe('combining-n\u{0303}-tilde');
    expect(gfmSlug('देवनागरी क्षि')).toBe('देवनागरी-क्षि');
    expect(gfmSlug('日本語の見出し')).toBe('日本語の見出し');
  });

  it('keeps connector punctuation', () => {
    expect(gfmSlug('a‿b undertie')).toBe('a‿b-undertie');
    expect(gfmSlug('a⁀b tie')).toBe('a⁀b-tie');
    expect(gfmSlug('a＿b fullwidth')).toBe('a＿b-fullwidth');
  });

  it('drops punctuation and symbols', () => {
    expect(gfmSlug('quotes \'single\' "double"')).toBe('quotes-single-double');
    expect(gfmSlug('copyright © and € and ∑')).toBe('copyright--and--and-');
    expect(gfmSlug('parens (and) [brackets]')).toBe('parens-and-brackets');
  });

  it('turns empty slugs into section', () => {
    expect(gfmSlug('!!!')).toBe('section');
    expect(gfmSlug('')).toBe('section');
  });
});
