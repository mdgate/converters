# @mdgate/mobi

**Convert MOBI and Kindle ebooks to Markdown in TypeScript.**

[`@mdgate/mobi`](https://github.com/mdgate/converters/tree/main/packages/mobi) reads `.mobi`, `.azw`, `.azw3`, and `.prc` files directly in JavaScript and converts them into GitHub-Flavored Markdown, without Python, native addons, WASM, or Kindle software.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/mobi
```

```ts
import { toMarkdown } from '@mdgate/mobi';

const markdown = await toMarkdown(bytes);
```

`bytes` is a `Uint8Array`, so the book can come from a file upload, object storage, an HTTP request, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/mobi`](https://github.com/mdgate/converters/tree/main/packages/mobi)

MOBI and KF8/AZW3 are binary Palm databases, not EPUB. A ZIP/HTML parser will not read them.

[`@mdgate/mobi`](https://github.com/mdgate/converters/tree/main/packages/mobi) is a MOBI reader written for the same runtime as your application:

* **Pure TypeScript**
* **MOBI → Markdown locally**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**
* **Detects PalmDB / MOBI headers from their contents, not only the filename**

---

## What it extracts

[`@mdgate/mobi`](https://github.com/mdgate/converters/tree/main/packages/mobi) reads PalmDOC and MOBI text records.

Supported compression:

* uncompressed PalmDOC
* PalmDOC LZ77
* HUFF/CDIC

KF8/AZW3 XHTML is converted when it can be isolated from the text stream. Skeleton + fragment reconstruction via INDX is not implemented, so some AZW3 books lose structure.

Not extracted:

* images, fonts, and audio
* NCX / table-of-contents indexes
* Topaz (`TPZ`) Kindle files

DRM-encrypted books fail with `ConvertError.encrypted`.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/mobi';

const bytes = new Uint8Array(await readFile('book.mobi'));
const markdown = await toMarkdown(bytes);

console.log(markdown);
```

---

## Browser

```ts
import { toMarkdown } from '@mdgate/mobi';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes);
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/mobi';

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

[`@mdgate/mobi`](https://github.com/mdgate/converters/tree/main/packages/mobi) recognizes PalmDB / MOBI headers from the bytes.

```ts
const markdown = await toMarkdown(bytes);
```

A path can still be supplied as a format hint when [`@mdgate/mobi`](https://github.com/mdgate/converters/tree/main/packages/mobi) is used through [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) or a reader composed with [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core), but the path is never used to read a file from disk.

---

## Encrypted books

DRM-encrypted books are reported as encrypted rather than returning misleading partial output.

---

## Compose it with other file readers

[`@mdgate/mobi`](https://github.com/mdgate/converters/tree/main/packages/mobi) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { mobi } from '@mdgate/mobi';
import { epub } from '@mdgate/epub';

const read = create([
  mobi(),
  epub(),
]);
```

The application still uses one reading interface while each format remains independently installable.

---

## Need more than MOBI?

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

[`@mdgate/mobi`](https://github.com/mdgate/converters/tree/main/packages/mobi) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
