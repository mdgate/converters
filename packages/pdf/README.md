# @mdgate/pdf

**Convert PDF to Markdown in TypeScript.**

[`@mdgate/pdf`](https://github.com/mdgate/converters/tree/main/packages/pdf) reads PDF files directly in JavaScript and converts their readable content into Markdown, without Python, native addons, WASM, or an external PDF service.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/pdf
```

```ts
import { toMarkdown } from '@mdgate/pdf';

const markdown = await toMarkdown(bytes);
```

`bytes` is a `Uint8Array`, so the PDF can come from a file upload, object storage, an HTTP request, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/pdf`](https://github.com/mdgate/converters/tree/main/packages/pdf)

PDF support often pulls a second document-processing stack into an otherwise JavaScript application.

[`@mdgate/pdf`](https://github.com/mdgate/converters/tree/main/packages/pdf) is a PDF reader written for the same runtime as your application:

* **Pure TypeScript**
* **PDF → Markdown locally**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**
* **Detects PDFs from their contents, not only the filename**

Use it when your application, AI agent, ingestion pipeline, or serverless function needs to read PDFs without operating a separate PDF-processing service.

---

## What it extracts

[`@mdgate/pdf`](https://github.com/mdgate/converters/tree/main/packages/pdf) reconstructs readable Markdown from positioned PDF content rather than treating the file as plain text.

The converter handles PDF-specific concerns including:

* page reading order
* positioned text
* common font encodings and embedded character maps
* CJK text
* superscript and subscript text
* table-like layouts
* duplicate and overlapping text
* encrypted PDF detection
* embedded images that can be handed back into a reader composed with [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core)

The output is Markdown that can be searched, indexed, chunked, cached, or passed directly to an AI agent.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/pdf';

const bytes = new Uint8Array(await readFile('report.pdf'));
const markdown = await toMarkdown(bytes);

console.log(markdown);
```

---

## Browser

PDFs can be converted directly from a browser file picker.

```ts
import { toMarkdown } from '@mdgate/pdf';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes);
```

For text-based PDFs, conversion can happen locally without uploading the document to a parsing service.

---

## Cloudflare Workers and Edge runtimes

Because [`@mdgate/pdf`](https://github.com/mdgate/converters/tree/main/packages/pdf) does not depend on Python, native binaries, WASM, or a separate execution runtime, it can be used as a normal JavaScript dependency in Cloudflare Workers and other Edge runtimes.

```ts
import { toMarkdown } from '@mdgate/pdf';

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

This makes it suitable for workflows such as:

```text
upload PDF
↓
Cloudflare Worker
↓
@mdgate/pdf
↓
Markdown
↓
agent / search / index / storage
```

---

## PDF detection

You do not need to trust the file extension.

[`@mdgate/pdf`](https://github.com/mdgate/converters/tree/main/packages/pdf) recognizes PDF content from the PDF signature itself.

```ts
const markdown = await toMarkdown(bytes);
```

A path can still be supplied as a format hint when [`@mdgate/pdf`](https://github.com/mdgate/converters/tree/main/packages/pdf) is used through [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) or a reader composed with [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core), but the path is never used to read a file from disk.

---

## Scanned and image-heavy PDFs

PDF is a container, not a guarantee that readable text exists.

A PDF may contain:

* selectable text
* embedded images
* scanned pages
* or a mixture of all three

[`@mdgate/pdf`](https://github.com/mdgate/converters/tree/main/packages/pdf) parses textual PDF content deterministically.

It does **not** silently send every PDF to an OCR or AI service.

When used inside a reader composed with [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core), supported embedded PDF images can be passed back through the same converter pipeline, allowing your application to connect the vision model or image reader it already uses.

This keeps the responsibilities separate:

```text
PDF text → deterministic PDF parser
PDF images → your chosen image / vision pipeline
```

For a purely scanned PDF, use an image-capable conversion path if you need the text visible in the scan.

---

## Encrypted PDFs

Encrypted or password-protected PDFs are reported as encrypted rather than returning misleading partial output.

That makes the behavior explicit for applications and agents that need to decide what to do next.

---

## Compose it with other file readers

[`@mdgate/pdf`](https://github.com/mdgate/converters/tree/main/packages/pdf) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { pdf } from '@mdgate/pdf';

const read = create([
  pdf(),
]);

const markdown = await read(bytes);
```

Add other converters when your application needs more than PDF:

```ts
import { create } from '@mdgate/core';
import { pdf } from '@mdgate/pdf';
import { docx } from '@mdgate/docx';
import { pptx } from '@mdgate/pptx';

const read = create([
  pdf(),
  docx(),
  pptx(),
]);
```

The application still uses one reading interface while each format remains independently installable.

---

## Need more than PDF?

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

[`@mdgate/pdf`](https://github.com/mdgate/converters/tree/main/packages/pdf) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
