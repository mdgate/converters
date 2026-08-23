# @mdgate/ppt

**Convert legacy PowerPoint `.ppt` files to Markdown in TypeScript.**

[`@mdgate/ppt`](https://github.com/mdgate/converters/tree/main/packages/ppt) reads binary PowerPoint files (`.ppt`, `.pps`, `.pot`) directly in JavaScript and converts slides into GitHub-Flavored Markdown, without Python, native addons, WASM, or PowerPoint.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/ppt
```

```ts
import { toMarkdown } from '@mdgate/ppt';

const markdown = await toMarkdown(bytes);
```

`bytes` is a `Uint8Array`, so the deck can come from a file upload, object storage, an HTTP request, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/ppt`](https://github.com/mdgate/converters/tree/main/packages/ppt)

Binary PowerPoint is still common in older mail threads and shared drives.

[`@mdgate/ppt`](https://github.com/mdgate/converters/tree/main/packages/ppt) reads the OLE compound file in the same runtime as your application:

* **Pure TypeScript**
* **PPT → Markdown locally**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**
* **Detects binary PowerPoint from OLE streams, not only the filename**

---

## What it extracts

[`@mdgate/ppt`](https://github.com/mdgate/converters/tree/main/packages/ppt) parses the binary presentation stream and rebuilds a shared document model.

The converter handles PowerPoint 97-2003 concerns including:

* slide text in reading order
* titles and body copy
* lists
* speaker notes when present
* encrypted document detection

OOXML decks (`.pptx`) are a different format. Use [`@mdgate/pptx`](https://github.com/mdgate/converters/tree/main/packages/pptx) for those.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/ppt';

const bytes = new Uint8Array(await readFile('deck.ppt'));
const markdown = await toMarkdown(bytes);

console.log(markdown);
```

---

## Browser

```ts
import { toMarkdown } from '@mdgate/ppt';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes);
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/ppt';

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

[`@mdgate/ppt`](https://github.com/mdgate/converters/tree/main/packages/ppt) recognizes binary PowerPoint from OLE compound-file streams.

```ts
const markdown = await toMarkdown(bytes);
```

A path can still be supplied as a format hint when [`@mdgate/ppt`](https://github.com/mdgate/converters/tree/main/packages/ppt) is used through [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) or a reader composed with [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core), but the path is never used to read a file from disk.

---

## Encrypted presentations

Encrypted or password-protected files are reported as encrypted rather than returning misleading partial output.

---

## Compose it with other file readers

[`@mdgate/ppt`](https://github.com/mdgate/converters/tree/main/packages/ppt) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { ppt } from '@mdgate/ppt';
import { pptx } from '@mdgate/pptx';

const read = create([
  ppt(),
  pptx(),
]);
```

The application still uses one reading interface while each format remains independently installable.

---

## Need more than PowerPoint?

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

[`@mdgate/ppt`](https://github.com/mdgate/converters/tree/main/packages/ppt) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
