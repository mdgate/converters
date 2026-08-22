# @mdgate/document

**The shared document model and GitHub-Flavored Markdown renderer.**

Official converters that can express structure build a `Document` here, then call `documentToMarkdown`. A table-escaping fix in this package applies to every format on that path.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/document
```

---

## Why [`@mdgate/document`](https://github.com/mdgate/converters/tree/main/packages/document)

Without a shared model, every parser emits its own Markdown dialect: different escaping, different tables, different footnotes.

This package is that dialect:

* headings, paragraphs, lists, tables, quotes, code
* bold, italic, strikethrough, links, inline code
* footnotes and endnotes
* heading anchors
* merged cells

Use it when you write a converter and want the same Markdown as [`@mdgate/docx`](https://github.com/mdgate/converters/tree/main/packages/docx) and [`@mdgate/pdf`](https://github.com/mdgate/converters/tree/main/packages/pdf).

---

## Build and render

```ts
import type { Converter } from '@mdgate/core';
import { documentToMarkdown, emptyDocument, heading, plain } from '@mdgate/document';

export function myFormat(): Converter {
  return {
    id: 'my-format',
    sniff(bytes) {
      return looksLikeMyFormat(bytes) ? 2 : 0;
    },
    convert(bytes) {
      const doc = emptyDocument();
      doc.blocks.push(heading(1, [plain('Title')]));
      return { markdown: documentToMarkdown(doc) };
    },
  };
}
```

You do not need this package to *call* `toMarkdown`. You need it to *implement* a converter that should match the official dialect.

---

## Need a complete reader?

```bash
npm install @mdgate/converters
```

```ts
import { toMarkdown } from '@mdgate/converters';

const markdown = await toMarkdown(bytes, {
  path: filename,
});
```

[`@mdgate/document`](https://github.com/mdgate/converters/tree/main/packages/document) is part of the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
