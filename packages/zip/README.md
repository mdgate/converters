# @mdgate/zip

**Convert ZIP archives to Markdown in TypeScript.**

[`@mdgate/zip`](https://github.com/mdgate/converters/tree/main/packages/zip) reads `.zip`, `.zipx`, and `.jar` files directly in JavaScript and converts each member into Markdown, without Python, native addons, WASM, or an unzip CLI.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/zip
```

```ts
import { toMarkdown } from '@mdgate/zip';

const markdown = await toMarkdown(bytes);
```

`bytes` is a `Uint8Array`, so the archive can come from a file upload, object storage, an HTTP request, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/zip`](https://github.com/mdgate/converters/tree/main/packages/zip)

A ZIP is a container. The useful content is inside: emails, Word files, PDFs, more ZIPs.

[`@mdgate/zip`](https://github.com/mdgate/converters/tree/main/packages/zip) is a ZIP reader written for the same runtime as your application:

* **Pure TypeScript**
* **ZIP members converted locally**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**
* **Detects generic ZIP from the PK signature, and leaves Office / ODF / EPUB / iWork packages to those converters**

---

## What it extracts

Used alone, [`@mdgate/zip`](https://github.com/mdgate/converters/tree/main/packages/zip) lists member names as Markdown.

Used inside `create()`, it hands each member back to the same converter registry:

```text
archive.zip
└── email.eml
    └── attachment.docx
        └── Markdown
```

The ZIP converter does not need to know how DOCX works. It passes nested bytes to `convert`.

Office, ODF, EPUB, and iWork packages are also ZIP files. Those converters win on sniff score, so [`@mdgate/zip`](https://github.com/mdgate/converters/tree/main/packages/zip) does not steal them.

Encrypted members are reported as encrypted.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/zip';

const bytes = new Uint8Array(await readFile('bundle.zip'));
const markdown = await toMarkdown(bytes);

console.log(markdown);
```

---

## Browser

```ts
import { toMarkdown } from '@mdgate/zip';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes);
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/zip';

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

## Compose it with other file readers

[`@mdgate/zip`](https://github.com/mdgate/converters/tree/main/packages/zip) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { zip } from '@mdgate/zip';
import { email } from '@mdgate/email';
import { docx } from '@mdgate/docx';
import { pdf } from '@mdgate/pdf';

const read = create([
  zip(),
  email(),
  docx(),
  pdf(),
]);

const markdown = await read(bytes);
```

Without nested `convert`, member names are listed as a bullet list.

The application still uses one reading interface while each format remains independently installable.

---

## Need more than ZIP?

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

[`@mdgate/zip`](https://github.com/mdgate/converters/tree/main/packages/zip) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
