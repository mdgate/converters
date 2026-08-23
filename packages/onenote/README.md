# @mdgate/onenote

**Convert Microsoft OneNote files to Markdown in TypeScript.**

[`@mdgate/onenote`](https://github.com/mdgate/converters/tree/main/packages/onenote) reads `.one`, `.onetoc2`, and `.onepkg` files directly in JavaScript and converts page text into GitHub-Flavored Markdown, without Python, native addons, WASM, or OneNote.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/onenote
```

```ts
import { toMarkdown } from '@mdgate/onenote';

const markdown = await toMarkdown(bytes);
```

`bytes` is a `Uint8Array`, so the notebook can come from a file upload, object storage, an HTTP request, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/onenote`](https://github.com/mdgate/converters/tree/main/packages/onenote)

OneNote stores notes in a proprietary revision format. There is no HTML or DOCX sitting inside a typical `.one` file.

[`@mdgate/onenote`](https://github.com/mdgate/converters/tree/main/packages/onenote) is a OneNote reader written for the same runtime as your application:

* **Pure TypeScript**
* **OneNote → Markdown locally**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**
* **Detects OneNote files from their contents, not only the filename**

---

## What it extracts

This converter is best-effort text extraction, not a full OneNote renderer.

It collects:

* page titles when they can be recognized
* readable body lines from OLE streams or packed bytes
* `.onepkg` ZIP members: when composed with `create()`, inner `.one` files are passed back through the same reader

It does not reconstruct OneNote ink, embedded files, or exact page layout.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/onenote';

const bytes = new Uint8Array(await readFile('meeting.one'));
const markdown = await toMarkdown(bytes);

console.log(markdown);
```

---

## Browser

```ts
import { toMarkdown } from '@mdgate/onenote';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes);
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/onenote';

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

[`@mdgate/onenote`](https://github.com/mdgate/converters/tree/main/packages/onenote) recognizes OneNote OLE files and `.onepkg` ZIP packages from their contents.

```ts
const markdown = await toMarkdown(bytes);
```

A path can still be supplied as a format hint when [`@mdgate/onenote`](https://github.com/mdgate/converters/tree/main/packages/onenote) is used through [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) or a reader composed with [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core), but the path is never used to read a file from disk.

---

## Compose it with other file readers

[`@mdgate/onenote`](https://github.com/mdgate/converters/tree/main/packages/onenote) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { onenote } from '@mdgate/onenote';
import { docx } from '@mdgate/docx';

const read = create([
  onenote(),
  docx(),
]);
```

The application still uses one reading interface while each format remains independently installable.

---

## Need more than OneNote?

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

[`@mdgate/onenote`](https://github.com/mdgate/converters/tree/main/packages/onenote) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
