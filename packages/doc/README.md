# @mdgate/doc

**Convert legacy Word `.doc` files to Markdown in TypeScript.**

[`@mdgate/doc`](https://github.com/mdgate/converters/tree/main/packages/doc) reads binary Word documents (`.doc`, `.dot`) directly in JavaScript and converts them into GitHub-Flavored Markdown, without Python, native addons, WASM, or Microsoft Word.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/doc
```

```ts
import { toMarkdown } from '@mdgate/doc';

const markdown = await toMarkdown(bytes);
```

`bytes` is a `Uint8Array`, so the document can come from a file upload, object storage, an HTTP request, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/doc`](https://github.com/mdgate/converters/tree/main/packages/doc)

Old Word files are still everywhere: attachments from 2004, government forms, mail archives.

Most JavaScript stacks have a DOCX parser and nothing for binary Word. [`@mdgate/doc`](https://github.com/mdgate/converters/tree/main/packages/doc) reads the OLE compound file in the same runtime as your application:

* **Pure TypeScript**
* **DOC → Markdown locally**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**
* **Detects binary Word from OLE streams, not only the filename**

Use it when an agent or ingestion pipeline has to read the Word format people actually sent, not only `.docx`.

---

## What it extracts

[`@mdgate/doc`](https://github.com/mdgate/converters/tree/main/packages/doc) parses the binary Word document stream and rebuilds a shared document model.

The converter handles Word 97-2003 concerns including:

* paragraphs and heading styles
* bold, italic, and strikethrough
* lists
* tables
* basic character encoding
* encrypted document detection

The output is Markdown that can be searched, indexed, chunked, cached, or passed directly to an AI agent.

OOXML Word files (`.docx`) are a different format. Use [`@mdgate/docx`](https://github.com/mdgate/converters/tree/main/packages/docx) for those.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/doc';

const bytes = new Uint8Array(await readFile('memo.doc'));
const markdown = await toMarkdown(bytes);

console.log(markdown);
```

---

## Browser

```ts
import { toMarkdown } from '@mdgate/doc';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes);
```

Conversion can happen locally without uploading the document to a parsing service.

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/doc';

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
upload DOC
↓
Cloudflare Worker
↓
@mdgate/doc
↓
Markdown
↓
agent / search / index / storage
```

---

## Format detection

You do not need to trust the file extension.

[`@mdgate/doc`](https://github.com/mdgate/converters/tree/main/packages/doc) recognizes binary Word from OLE compound-file streams.

```ts
const markdown = await toMarkdown(bytes);
```

A path can still be supplied as a format hint when [`@mdgate/doc`](https://github.com/mdgate/converters/tree/main/packages/doc) is used through [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) or a reader composed with [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core), but the path is never used to read a file from disk.

Some files named `.doc` are actually RTF. Those belong to [`@mdgate/rtf`](https://github.com/mdgate/converters/tree/main/packages/rtf).

---

## Encrypted documents

Encrypted or password-protected Word files are reported as encrypted rather than returning misleading partial output.

---

## Compose it with other file readers

[`@mdgate/doc`](https://github.com/mdgate/converters/tree/main/packages/doc) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { doc } from '@mdgate/doc';
import { docx } from '@mdgate/docx';

const read = create([
  doc(),
  docx(),
]);

const markdown = await read(bytes);
```

The application still uses one reading interface while each format remains independently installable.

---

## Need more than Word?

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

[`@mdgate/doc`](https://github.com/mdgate/converters/tree/main/packages/doc) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
