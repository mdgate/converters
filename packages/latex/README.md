# @mdgate/latex

**Convert LaTeX source to Markdown in TypeScript.**

[`@mdgate/latex`](https://github.com/mdgate/converters/tree/main/packages/latex) reads `.tex`, `.latex`, and `.ltx` files directly in JavaScript and converts them into GitHub-Flavored Markdown, without Python, native addons, WASM, or a TeX engine.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/latex
```

```ts
import { toMarkdown } from '@mdgate/latex';

const markdown = await toMarkdown(bytes);
```

`bytes` is a `Uint8Array`, so the source can come from a file upload, a git checkout, an HTTP request, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/latex`](https://github.com/mdgate/converters/tree/main/packages/latex)

LaTeX is source, not a rendered PDF. An agent that needs the paper's structure can read the `.tex` without running TeX.

[`@mdgate/latex`](https://github.com/mdgate/converters/tree/main/packages/latex) is a LaTeX reader written for the same runtime as your application:

* **Pure TypeScript**
* **LaTeX → Markdown locally**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**

This is not a full TeX engine. It does not typeset, resolve `\input` trees from disk, or run packages.

---

## What it extracts

[`@mdgate/latex`](https://github.com/mdgate/converters/tree/main/packages/latex) walks common LaTeX commands and environments and rebuilds a shared document model.

The converter handles LaTeX-specific concerns including:

* `\section` and related headings
* paragraphs
* bold, italic, and inline code
* lists
* tables from common tabular markup
* footnotes when present
* dropping preamble commands such as `\documentclass` and `\usepackage`

The output is Markdown that can be searched, indexed, chunked, cached, or passed directly to an AI agent.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/latex';

const bytes = new Uint8Array(await readFile('paper.tex'));
const markdown = await toMarkdown(bytes);

console.log(markdown);
```

---

## Browser

```ts
import { toMarkdown } from '@mdgate/latex';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes);
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/latex';

export default {
  async fetch(request: Request) {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const markdown = await toMarkdown(bytes);

    return new Response(markdown, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
      },
    });
  },
};
```

---

## Format detection

Common LaTeX source can be recognized from its contents. A path hint still helps when the file is composed with other text converters:

```ts
const markdown = await toMarkdown(bytes, {
  path: 'paper.tex',
});
```

The path is never used to read a file from disk.

---

## Compose it with other file readers

[`@mdgate/latex`](https://github.com/mdgate/converters/tree/main/packages/latex) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { latex } from '@mdgate/latex';
import { pdf } from '@mdgate/pdf';

const read = create([
  latex(),
  pdf(),
]);
```

The application still uses one reading interface while each format remains independently installable.

---

## Need more than LaTeX?

If your application needs to read many different file types, use the complete converter set:

```bash
npm install @mdgate/converters
```

```ts
import { toMarkdown } from '@mdgate/converters';

const markdown = await toMarkdown(bytes, {
  path: filename,
});
```

[`@mdgate/latex`](https://github.com/mdgate/converters/tree/main/packages/latex) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
