# @mdgate/wps

**Convert WPS Office files to Markdown in TypeScript.**

[`@mdgate/wps`](https://github.com/mdgate/converters/tree/main/packages/wps) reads Kingsoft WPS Writer, Spreadsheets, and Presentation files (`.wps`, `.wpt`, `.et`, `.ett`, `.dps`, `.dpt`) directly in JavaScript and converts them into GitHub-Flavored Markdown, without Python, native addons, WASM, or WPS Office.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/wps
```

```ts
import { toMarkdown } from '@mdgate/wps';

const markdown = await toMarkdown(bytes);
```

`bytes` is a `Uint8Array`, so the file can come from a file upload, object storage, an HTTP request, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/wps`](https://github.com/mdgate/converters/tree/main/packages/wps)

WPS Office is widely used in China. Some WPS files are Office-compatible OOXML or OLE packages. Others are proprietary Kingsoft packages.

[`@mdgate/wps`](https://github.com/mdgate/converters/tree/main/packages/wps) is a WPS reader written for the same runtime as your application:

* **Pure TypeScript**
* **WPS → Markdown locally**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**
* **Detects WPS files from contents and extension, not only the filename**

---

## What it extracts

When the file is an Office-compatible OOXML or OLE package, [`@mdgate/wps`](https://github.com/mdgate/converters/tree/main/packages/wps) delegates to the matching official converter (Word, Excel, or PowerPoint).

When the file is a proprietary Kingsoft package, extraction is best-effort text:

* readable strings from ZIP parts or OLE streams
* duplicate runs removed
* no claim of full WPS layout reconstruction

Encrypted Office-compatible packages are reported as encrypted.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/wps';

const bytes = new Uint8Array(await readFile('report.wps'));
const markdown = await toMarkdown(bytes);

console.log(markdown);
```

---

## Browser

```ts
import { toMarkdown } from '@mdgate/wps';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes);
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/wps';

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

A path hint helps route `.wps` / `.et` / `.dps` files. Office-compatible contents are still identified from the package itself.

A path is never used to read a file from disk.

---

## Compose it with other file readers

[`@mdgate/wps`](https://github.com/mdgate/converters/tree/main/packages/wps) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { wps } from '@mdgate/wps';
import { docx } from '@mdgate/docx';
import { xlsx } from '@mdgate/xlsx';

const read = create([
  wps(),
  docx(),
  xlsx(),
]);
```

The application still uses one reading interface while each format remains independently installable.

---

## Need more than WPS?

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

[`@mdgate/wps`](https://github.com/mdgate/converters/tree/main/packages/wps) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
