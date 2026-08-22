# @mdgate/numbers

**Convert Apple Numbers spreadsheets to Markdown in TypeScript.**

[`@mdgate/numbers`](https://github.com/mdgate/converters/tree/main/packages/numbers) reads `.numbers` files directly in JavaScript and converts tables into GitHub-Flavored Markdown, without Python, native addons, WASM, or Numbers.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/numbers
```

```ts
import { toMarkdown } from '@mdgate/numbers';

const markdown = await toMarkdown(bytes);
```

`bytes` is a `Uint8Array`, so the spreadsheet can come from a file upload, object storage, iCloud export, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/numbers`](https://github.com/mdgate/converters/tree/main/packages/numbers)

Numbers files are iWork packages. An Excel parser will not read them.

[`@mdgate/numbers`](https://github.com/mdgate/converters/tree/main/packages/numbers) is a Numbers reader written for the same runtime as your application:

* **Pure TypeScript**
* **Numbers → Markdown locally**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**
* **Detects Numbers packages from their contents, not only the filename**

---

## What it extracts

[`@mdgate/numbers`](https://github.com/mdgate/converters/tree/main/packages/numbers) opens the iWork archive, reads TST table storage from IWA protobuf, and rebuilds a shared document model.

The converter handles Numbers-specific concerns including:

* sheets and tables as Markdown tables
* cell text in table order
* table structure from the iWork archive

The output is Markdown that can be searched, indexed, chunked, cached, or passed directly to an AI agent.

Excel workbooks are a different format. Use [`@mdgate/xlsx`](https://github.com/mdgate/converters/tree/main/packages/xlsx) for those.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/numbers';

const bytes = new Uint8Array(await readFile('budget.numbers'));
const markdown = await toMarkdown(bytes);

console.log(markdown);
```

---

## Browser

```ts
import { toMarkdown } from '@mdgate/numbers';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes);
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/numbers';

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

[`@mdgate/numbers`](https://github.com/mdgate/converters/tree/main/packages/numbers) recognizes Numbers iWork packages from ZIP / `Index.zip` contents.

```ts
const markdown = await toMarkdown(bytes);
```

A path can still be supplied as a format hint when [`@mdgate/numbers`](https://github.com/mdgate/converters/tree/main/packages/numbers) is used through [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) or a reader composed with [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core), but the path is never used to read a file from disk.

---

## Compose it with other file readers

[`@mdgate/numbers`](https://github.com/mdgate/converters/tree/main/packages/numbers) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { numbers } from '@mdgate/numbers';
import { xlsx } from '@mdgate/xlsx';

const read = create([
  numbers(),
  xlsx(),
]);
```

The application still uses one reading interface while each format remains independently installable.

---

## Need more than Numbers?

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

[`@mdgate/numbers`](https://github.com/mdgate/converters/tree/main/packages/numbers) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
