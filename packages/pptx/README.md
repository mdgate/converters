# @mdgate/pptx

**Convert PowerPoint to Markdown in TypeScript.**

[`@mdgate/pptx`](https://github.com/mdgate/converters/tree/main/packages/pptx) reads `.pptx`, `.pptm`, `.ppsx`, `.ppsm`, `.potx`, and `.potm` files directly in JavaScript and converts slides into GitHub-Flavored Markdown, without Python, native addons, WASM, or PowerPoint.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/pptx
```

```ts
import { toMarkdown } from '@mdgate/pptx';

const markdown = await toMarkdown(bytes);
```

`bytes` is a `Uint8Array`, so the deck can come from a file upload, object storage, an HTTP request, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/pptx`](https://github.com/mdgate/converters/tree/main/packages/pptx)

Slide decks are a common way people store the actual argument: titles, bullets, tables, speaker notes.

[`@mdgate/pptx`](https://github.com/mdgate/converters/tree/main/packages/pptx) is a PresentationML reader written for the same runtime as your application:

* **Pure TypeScript**
* **PPTX → Markdown locally**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**
* **Detects OOXML presentations from their contents, not only the filename**

Use it when an agent needs the contents of a deck, not a screenshot pipeline.

---

## What it extracts

[`@mdgate/pptx`](https://github.com/mdgate/converters/tree/main/packages/pptx) walks slides in package order and applies the text cascade: slide, then layout, then master, then presentation defaults.

The converter handles PowerPoint-specific concerns including:

* slide titles and body text
* lists
* tables
* speaker notes, rendered as a block quote after each slide
* charts and diagrams as readable blocks when present
* images that can be handed to a reader composed with [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core)

The output is Markdown that can be searched, indexed, chunked, cached, or passed directly to an AI agent.

Legacy binary `.ppt` files are a different format. Use [`@mdgate/ppt`](https://github.com/mdgate/converters/tree/main/packages/ppt) for those.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/pptx';

const bytes = new Uint8Array(await readFile('deck.pptx'));
const markdown = await toMarkdown(bytes);

console.log(markdown);
```

---

## Browser

```ts
import { toMarkdown } from '@mdgate/pptx';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes);
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/pptx';

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

```text
upload PPTX
↓
Cloudflare Worker
↓
@mdgate/pptx
↓
Markdown
↓
agent / search / index / storage
```

---

## Format detection

You do not need to trust the file extension.

[`@mdgate/pptx`](https://github.com/mdgate/converters/tree/main/packages/pptx) recognizes PowerPoint OOXML packages from ZIP package metadata.

```ts
const markdown = await toMarkdown(bytes);
```

A path can still be supplied as a format hint when [`@mdgate/pptx`](https://github.com/mdgate/converters/tree/main/packages/pptx) is used through [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) or a reader composed with [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core), but the path is never used to read a file from disk.

---

## Compose it with other file readers

[`@mdgate/pptx`](https://github.com/mdgate/converters/tree/main/packages/pptx) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { pptx } from '@mdgate/pptx';
import { pdf } from '@mdgate/pdf';
import { docx } from '@mdgate/docx';

const read = create([
  pptx(),
  pdf(),
  docx(),
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

[`@mdgate/pptx`](https://github.com/mdgate/converters/tree/main/packages/pptx) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
