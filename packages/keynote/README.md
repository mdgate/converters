# @mdgate/keynote

**Convert Apple Keynote presentations to Markdown in TypeScript.**

[`@mdgate/keynote`](https://github.com/mdgate/converters/tree/main/packages/keynote) reads `.key` files directly in JavaScript and converts slides into GitHub-Flavored Markdown, without Python, native addons, WASM, or Keynote.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/keynote
```

```ts
import { toMarkdown } from '@mdgate/keynote';

const markdown = await toMarkdown(bytes);
```

`bytes` is a `Uint8Array`, so the deck can come from a file upload, object storage, iCloud export, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/keynote`](https://github.com/mdgate/converters/tree/main/packages/keynote)

Keynote files are iWork packages. A PowerPoint parser will not read them.

[`@mdgate/keynote`](https://github.com/mdgate/converters/tree/main/packages/keynote) is a Keynote reader written for the same runtime as your application:

* **Pure TypeScript**
* **Keynote → Markdown locally**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**
* **Detects Keynote packages from their contents, not only the filename**

---

## What it extracts

[`@mdgate/keynote`](https://github.com/mdgate/converters/tree/main/packages/keynote) opens the iWork archive, reads slide text storage from IWA protobuf, and rebuilds a shared document model.

The converter handles Keynote-specific concerns including:

* slide text in order
* titles and body copy
* lists
* tables on slides when present

The output is Markdown that can be searched, indexed, chunked, cached, or passed directly to an AI agent.

PowerPoint files are a different format. Use [`@mdgate/pptx`](https://github.com/mdgate/converters/tree/main/packages/pptx) for those.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/keynote';

const bytes = new Uint8Array(await readFile('talk.key'));
const markdown = await toMarkdown(bytes);

console.log(markdown);
```

---

## Browser

```ts
import { toMarkdown } from '@mdgate/keynote';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes);
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/keynote';

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

[`@mdgate/keynote`](https://github.com/mdgate/converters/tree/main/packages/keynote) recognizes Keynote iWork packages from ZIP / `Index.zip` contents.

```ts
const markdown = await toMarkdown(bytes);
```

A path can still be supplied as a format hint when [`@mdgate/keynote`](https://github.com/mdgate/converters/tree/main/packages/keynote) is used through [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) or a reader composed with [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core), but the path is never used to read a file from disk.

---

## Compose it with other file readers

[`@mdgate/keynote`](https://github.com/mdgate/converters/tree/main/packages/keynote) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { keynote } from '@mdgate/keynote';
import { pptx } from '@mdgate/pptx';

const read = create([
  keynote(),
  pptx(),
]);
```

The application still uses one reading interface while each format remains independently installable.

---

## Need more than Keynote?

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

[`@mdgate/keynote`](https://github.com/mdgate/converters/tree/main/packages/keynote) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
