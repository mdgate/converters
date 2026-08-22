# @mdgate/html

**Convert HTML to Markdown in TypeScript.**

[`@mdgate/html`](https://github.com/mdgate/converters/tree/main/packages/html) reads `.html`, `.htm`, `.html4`, `.html5`, `.xhtml`, `.mhtml`, and `.mht` files directly in JavaScript and converts them into GitHub-Flavored Markdown, without Python, native addons, WASM, or a browser engine.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/html
```

```ts
import { toMarkdown } from '@mdgate/html';

const markdown = await toMarkdown(bytes);
```

`bytes` is a `Uint8Array`, so the page can come from a file upload, a crawl, an HTTP response, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/html`](https://github.com/mdgate/converters/tree/main/packages/html)

HTML is the interchange format for saved pages, MHTML archives, and a lot of "export as web page" output from office tools.

[`@mdgate/html`](https://github.com/mdgate/converters/tree/main/packages/html) is an HTML reader written for the same runtime as your application:

* **Pure TypeScript**
* **HTML → Markdown locally**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**
* **Detects HTML and MHTML from their contents, not only the filename**

---

## What it extracts

[`@mdgate/html`](https://github.com/mdgate/converters/tree/main/packages/html) parses the markup, walks the tree, and rebuilds a shared document model.

The converter handles HTML-specific concerns including:

* headings, paragraphs, and block quotes
* bold, italic, strikethrough, and inline code
* links and relative URLs
* ordered, unordered, and nested lists
* tables, including spanning cells
* code blocks
* MHTML / MHT archives (MIME-wrapped HTML)
* XHTML

The output is Markdown that can be searched, indexed, chunked, cached, or passed directly to an AI agent.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/html';

const bytes = new Uint8Array(await readFile('page.html'));
const markdown = await toMarkdown(bytes);

console.log(markdown);
```

---

## Browser

```ts
import { toMarkdown } from '@mdgate/html';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes);
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/html';

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

You do not need to trust the file extension.

[`@mdgate/html`](https://github.com/mdgate/converters/tree/main/packages/html) recognizes HTML and MHTML from their contents.

```ts
const markdown = await toMarkdown(bytes);
```

A path can still be supplied as a format hint when [`@mdgate/html`](https://github.com/mdgate/converters/tree/main/packages/html) is used through [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) or a reader composed with [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core), but the path is never used to read a file from disk.

---

## Compose it with other file readers

[`@mdgate/html`](https://github.com/mdgate/converters/tree/main/packages/html) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { html } from '@mdgate/html';
import { email } from '@mdgate/email';

const read = create([
  html(),
  email(),
]);
```

The application still uses one reading interface while each format remains independently installable.

---

## Need more than HTML?

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

[`@mdgate/html`](https://github.com/mdgate/converters/tree/main/packages/html) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
