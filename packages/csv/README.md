# @mdgate/csv

**Convert CSV files to Markdown in TypeScript.**

[`@mdgate/csv`](https://github.com/mdgate/converters/tree/main/packages/csv) reads `.csv`, `.tsv`, and `.tab` files directly in JavaScript and converts them into GitHub-Flavored Markdown tables, without Python, native addons, or a spreadsheet runtime.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/csv
```

```ts
import { toMarkdown } from '@mdgate/csv';

const markdown = await toMarkdown(bytes, {
  path: 'records.csv',
});
```

`bytes` is a `Uint8Array`, so the file can come from a file upload, object storage, an HTTP request, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/csv`](https://github.com/mdgate/converters/tree/main/packages/csv)

CSV has no file signature. A bytes-only sniffer cannot tell it from other text. This converter exists so CSV can join the same `toMarkdown(bytes)` interface as Word and PDF.

* **Pure TypeScript**
* **CSV to Markdown tables locally**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**
* **Needs a path hint, because CSV has no reliable content signature**

---

## What it extracts

[`@mdgate/csv`](https://github.com/mdgate/converters/tree/main/packages/csv) parses comma, semicolon, or tab-separated text (UTF-8 or UTF-16) and rebuilds a Markdown table.

The converter handles CSV-specific concerns including:

* quoted fields
* comma, semicolon, and tab delimiters
* UTF-8 and UTF-16
* `.csv`, `.tsv`, and `.tab`

Excel workbooks are a different format. Use [`@mdgate/xlsx`](https://github.com/mdgate/converters/tree/main/packages/xlsx) for those.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/csv';

const bytes = new Uint8Array(await readFile('records.csv'));
const markdown = await toMarkdown(bytes, {
  path: 'records.csv',
});

console.log(markdown);
```

---

## Browser

```ts
import { toMarkdown } from '@mdgate/csv';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes, {
  path: file.name,
});
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/csv';

export default {
  async fetch(request: Request) {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const markdown = await toMarkdown(bytes, {
      path: request.headers.get('x-filename') ?? 'upload.csv',
    });

    return new Response(markdown, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
      },
    });
  },
};
```

---

## Path hint

CSV cannot be identified from a magic number. Pass `path` so the converter can claim the file when it is composed with others.

The path is never used to read a file from disk.

---

## Compose it with other file readers

[`@mdgate/csv`](https://github.com/mdgate/converters/tree/main/packages/csv) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { csv } from '@mdgate/csv';
import { xlsx } from '@mdgate/xlsx';

const read = create([
  csv(),
  xlsx(),
]);

const markdown = await read(bytes, {
  path: 'records.csv',
});
```

The application still uses one reading interface while each format remains independently installable.

---

## Need more than CSV?

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

[`@mdgate/csv`](https://github.com/mdgate/converters/tree/main/packages/csv) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
