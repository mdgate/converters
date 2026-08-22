# @mdgate/odf

**Convert OpenDocument files to Markdown in TypeScript.**

[`@mdgate/odf`](https://github.com/mdgate/converters/tree/main/packages/odf) reads OpenDocument text, spreadsheets, presentations, and drawings directly in JavaScript and converts them into GitHub-Flavored Markdown, without Python, native addons, WASM, or LibreOffice.

Handles `.odt`, `.ods`, `.odp`, `.odg`, templates (`.ott`, `.ots`, `.otp`, `.otg`), and flat XML (`.fodt`, `.fods`, `.fodp`, `.fodg`).

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/odf
```

```ts
import { toMarkdown } from '@mdgate/odf';

const markdown = await toMarkdown(bytes);
```

`bytes` is a `Uint8Array`, so the file can come from a file upload, object storage, an HTTP request, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/odf`](https://github.com/mdgate/converters/tree/main/packages/odf)

OpenDocument is the native format of LibreOffice, many government systems, and a large share of non-Microsoft office files.

[`@mdgate/odf`](https://github.com/mdgate/converters/tree/main/packages/odf) is an ODF reader written for the same runtime as your application:

* **Pure TypeScript**
* **ODF → Markdown locally**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**
* **Detects ODF packages and flat XML from their contents, not only the filename**

---

## What it extracts

[`@mdgate/odf`](https://github.com/mdgate/converters/tree/main/packages/odf) reads the ODF XML (from a ZIP package or a flat XML file) and rebuilds a shared document model.

The converter handles OpenDocument concerns including:

* text documents: headings, paragraphs, lists, links, emphasis
* spreadsheets: sheets as Markdown tables
* presentations: slide text in order
* drawings: readable text from the drawing
* styles that map onto headings and emphasis
* tables, including spanning cells where present

The output is Markdown that can be searched, indexed, chunked, cached, or passed directly to an AI agent.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/odf';

const bytes = new Uint8Array(await readFile('paper.odt'));
const markdown = await toMarkdown(bytes);

console.log(markdown);
```

---

## Browser

```ts
import { toMarkdown } from '@mdgate/odf';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes);
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/odf';

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

[`@mdgate/odf`](https://github.com/mdgate/converters/tree/main/packages/odf) recognizes ODF ZIP packages from their mimetype and flat ODF from XML structure.

```ts
const markdown = await toMarkdown(bytes);
```

A path can still be supplied as a format hint when [`@mdgate/odf`](https://github.com/mdgate/converters/tree/main/packages/odf) is used through [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) or a reader composed with [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core), but the path is never used to read a file from disk.

---

## Compose it with other file readers

[`@mdgate/odf`](https://github.com/mdgate/converters/tree/main/packages/odf) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { odf } from '@mdgate/odf';
import { docx } from '@mdgate/docx';
import { pdf } from '@mdgate/pdf';

const read = create([
  odf(),
  docx(),
  pdf(),
]);
```

The application still uses one reading interface while each format remains independently installable.

---

## Need more than OpenDocument?

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

[`@mdgate/odf`](https://github.com/mdgate/converters/tree/main/packages/odf) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
