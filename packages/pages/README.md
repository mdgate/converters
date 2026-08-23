# @mdgate/pages

**Convert Apple Pages documents to Markdown in TypeScript.**

[`@mdgate/pages`](https://github.com/mdgate/converters/tree/main/packages/pages) reads `.pages` files directly in JavaScript and converts them into GitHub-Flavored Markdown, without Python, native addons, WASM, or Pages.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/pages
```

```ts
import { toMarkdown } from '@mdgate/pages';

const markdown = await toMarkdown(bytes);
```

`bytes` is a `Uint8Array`, so the document can come from a file upload, object storage, iCloud export, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/pages`](https://github.com/mdgate/converters/tree/main/packages/pages)

Pages files are iWork packages, not Word files with a different extension. A DOCX parser will not read them.

[`@mdgate/pages`](https://github.com/mdgate/converters/tree/main/packages/pages) is a Pages reader written for the same runtime as your application:

* **Pure TypeScript**
* **Pages → Markdown locally**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**
* **Detects Pages packages from their contents, not only the filename**

---

## What it extracts

[`@mdgate/pages`](https://github.com/mdgate/converters/tree/main/packages/pages) opens the iWork archive, reads IWA protobuf storage (and older pre-IWA documents when needed), and rebuilds a shared document model.

The converter handles Pages-specific concerns including:

* headings and paragraphs
* emphasis
* lists
* tables
* text storage order inside the iWork package

The output is Markdown that can be searched, indexed, chunked, cached, or passed directly to an AI agent.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/pages';

const bytes = new Uint8Array(await readFile('essay.pages'));
const markdown = await toMarkdown(bytes);

console.log(markdown);
```

---

## Browser

```ts
import { toMarkdown } from '@mdgate/pages';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes);
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/pages';

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

[`@mdgate/pages`](https://github.com/mdgate/converters/tree/main/packages/pages) recognizes Pages iWork packages from ZIP / `Index.zip` contents.

```ts
const markdown = await toMarkdown(bytes);
```

A path can still be supplied as a format hint when [`@mdgate/pages`](https://github.com/mdgate/converters/tree/main/packages/pages) is used through [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) or a reader composed with [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core), but the path is never used to read a file from disk.

---

## Compose it with other file readers

[`@mdgate/pages`](https://github.com/mdgate/converters/tree/main/packages/pages) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { pages } from '@mdgate/pages';
import { docx } from '@mdgate/docx';
import { pdf } from '@mdgate/pdf';

const read = create([
  pages(),
  docx(),
  pdf(),
]);
```

The application still uses one reading interface while each format remains independently installable.

---

## Need more than Pages?

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

[`@mdgate/pages`](https://github.com/mdgate/converters/tree/main/packages/pages) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
