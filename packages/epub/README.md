# @mdgate/epub

**Convert EPUB books to Markdown in TypeScript.**

[`@mdgate/epub`](https://github.com/mdgate/converters/tree/main/packages/epub) reads `.epub` and `.ibooks` files directly in JavaScript and converts chapters into GitHub-Flavored Markdown, without Python, native addons, WASM, or an ebook app.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/epub
```

```ts
import { toMarkdown } from '@mdgate/epub';

const markdown = await toMarkdown(bytes);
```

`bytes` is a `Uint8Array`, so the book can come from a file upload, object storage, an HTTP request, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/epub`](https://github.com/mdgate/converters/tree/main/packages/epub)

EPUB is a ZIP of HTML plus a spine. Dumping the archive is not a book an agent can read.

[`@mdgate/epub`](https://github.com/mdgate/converters/tree/main/packages/epub) is an EPUB reader written for the same runtime as your application:

* **Pure TypeScript**
* **EPUB → Markdown locally**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**
* **Detects EPUB packages from their contents, not only the filename**

---

## What it extracts

[`@mdgate/epub`](https://github.com/mdgate/converters/tree/main/packages/epub) opens the package, follows the spine, and converts chapter HTML through the shared HTML document model.

The converter handles EPUB-specific concerns including:

* spine order
* chapter HTML as Markdown
* headings, paragraphs, lists, links, and tables from the chapter markup
* iBooks packages that use the same ZIP + HTML shape

The output is Markdown that can be searched, indexed, chunked, cached, or passed directly to an AI agent.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/epub';

const bytes = new Uint8Array(await readFile('book.epub'));
const markdown = await toMarkdown(bytes);

console.log(markdown);
```

---

## Browser

```ts
import { toMarkdown } from '@mdgate/epub';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes);
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/epub';

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

[`@mdgate/epub`](https://github.com/mdgate/converters/tree/main/packages/epub) recognizes EPUB ZIP packages from their mimetype and container metadata.

```ts
const markdown = await toMarkdown(bytes);
```

A path can still be supplied as a format hint when [`@mdgate/epub`](https://github.com/mdgate/converters/tree/main/packages/epub) is used through [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) or a reader composed with [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core), but the path is never used to read a file from disk.

---

## Compose it with other file readers

[`@mdgate/epub`](https://github.com/mdgate/converters/tree/main/packages/epub) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { epub } from '@mdgate/epub';
import { pdf } from '@mdgate/pdf';

const read = create([
  epub(),
  pdf(),
]);
```

The application still uses one reading interface while each format remains independently installable.

---

## Need more than EPUB?

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

[`@mdgate/epub`](https://github.com/mdgate/converters/tree/main/packages/epub) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
