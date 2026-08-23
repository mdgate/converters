# @mdgate/hwp

**Convert Hangul / Hancom documents to Markdown in TypeScript.**

[`@mdgate/hwp`](https://github.com/mdgate/converters/tree/main/packages/hwp) reads `.hwp`, `.hwpx`, `.hwt`, and `.hwtx` files directly in JavaScript and converts them into GitHub-Flavored Markdown, without Python, native addons, WASM, or Hancom Office.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/hwp
```

```ts
import { toMarkdown } from '@mdgate/hwp';

const markdown = await toMarkdown(bytes);
```

`bytes` is a `Uint8Array`, so the document can come from a file upload, object storage, an HTTP request, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/hwp`](https://github.com/mdgate/converters/tree/main/packages/hwp)

HWP is a default office format in a large part of Korea. A Word parser will not read it.

[`@mdgate/hwp`](https://github.com/mdgate/converters/tree/main/packages/hwp) is a Hangul reader written for the same runtime as your application:

* **Pure TypeScript**
* **HWP → Markdown locally**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**
* **Detects HWP / HWPX from their contents, not only the filename**

Use it when an agent or ingestion pipeline has to read the files Korean users actually send.

---

## What it extracts

HWP is several formats under one name. [`@mdgate/hwp`](https://github.com/mdgate/converters/tree/main/packages/hwp) handles them differently.

**HWPX / HWTX** (ZIP + OWPML):

* paragraphs and line breaks from `Contents/section*.xml`
* heading styles from `Contents/header.xml` when present
* tables

**HWP / HWT** (OLE HWP 5, or the classic `HWP Document File` signature for HWP 3):

* `PARA_TEXT` records when the binary layout is recognizable
* readable UTF-16 strings and the `PrvText` preview as paragraphs when a stream is too opaque
* tables, drawings, and other binary controls are not reconstructed

The binary record format is only partly specified in public. The converter prefers structured text when it can find it, and falls back to extracted strings rather than pretending it has a full HWP renderer.

Encrypted or distribution-locked documents fail with `ConvertError.encrypted`.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/hwp';

const bytes = new Uint8Array(await readFile('report.hwp'));
const markdown = await toMarkdown(bytes);

console.log(markdown);
```

---

## Browser

```ts
import { toMarkdown } from '@mdgate/hwp';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes);
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/hwp';

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
upload HWP
↓
Cloudflare Worker
↓
@mdgate/hwp
↓
Markdown
↓
agent / search / index / storage
```

---

## Format detection

You do not need to trust the file extension.

[`@mdgate/hwp`](https://github.com/mdgate/converters/tree/main/packages/hwp) recognizes HWPX ZIP packages, HWP 5 OLE streams, and the HWP 3 file signature from the bytes.

```ts
const markdown = await toMarkdown(bytes);
```

A path can still be supplied as a format hint when [`@mdgate/hwp`](https://github.com/mdgate/converters/tree/main/packages/hwp) is used through [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) or a reader composed with [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core), but the path is never used to read a file from disk.

---

## Encrypted documents

Encrypted or password-protected HWP files are reported as encrypted rather than returning misleading partial output.

---

## Compose it with other file readers

[`@mdgate/hwp`](https://github.com/mdgate/converters/tree/main/packages/hwp) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { hwp } from '@mdgate/hwp';
import { docx } from '@mdgate/docx';
import { pdf } from '@mdgate/pdf';

const read = create([
  hwp(),
  docx(),
  pdf(),
]);
```

The application still uses one reading interface while each format remains independently installable.

---

## Need more than HWP?

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

[`@mdgate/hwp`](https://github.com/mdgate/converters/tree/main/packages/hwp) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
