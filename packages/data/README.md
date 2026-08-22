# @mdgate/data

**Convert JSON, JSONL, XML, and YAML to Markdown in TypeScript.**

[`@mdgate/data`](https://github.com/mdgate/converters/tree/main/packages/data) reads `.json`, `.jsonl`, `.xml`, `.yaml`, and `.yml` files directly in JavaScript and converts them into GitHub-Flavored Markdown, without Python, native addons, or an extra parser stack.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/data
```

```ts
import { toMarkdown } from '@mdgate/data';

const markdown = await toMarkdown(bytes, {
  path: 'config.yaml',
});
```

`bytes` is a `Uint8Array`, so the file can come from a file upload, object storage, an HTTP request, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/data`](https://github.com/mdgate/converters/tree/main/packages/data)

Structured data files are already text, but they are not Markdown. Agents and search indexes work better with a heading-and-list shape than with a raw dump.

[`@mdgate/data`](https://github.com/mdgate/converters/tree/main/packages/data) is a data reader written for the same runtime as your application:

* **Pure TypeScript**
* **JSON / XML / YAML → Markdown locally**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**

---

## What it extracts

* JSON objects and arrays as nested Markdown structure
* JSONL as one record after another
* YAML mappings and sequences
* XML as nested headings and text

XML is never claimed by content signature alone. Flat ODF and many office parts start with `<?xml`, so XML needs a path hint (`.xml`) when composed with other converters.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/data';

const bytes = new Uint8Array(await readFile('records.jsonl'));
const markdown = await toMarkdown(bytes, {
  path: 'records.jsonl',
});

console.log(markdown);
```

---

## Browser

```ts
import { toMarkdown } from '@mdgate/data';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes, {
  path: file.name,
});
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/data';

export default {
  async fetch(request: Request) {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const markdown = await toMarkdown(bytes, {
      path: request.headers.get('x-filename') ?? undefined,
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

## Format detection

JSON can often be identified from the bytes. XML and YAML should be named with `path`.

The path is never used to read a file from disk.

---

## Compose it with other file readers

[`@mdgate/data`](https://github.com/mdgate/converters/tree/main/packages/data) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { data } from '@mdgate/data';
import { csv } from '@mdgate/csv';
import { text } from '@mdgate/text';

const read = create([
  data(),
  csv(),
  text(),
]);
```

The application still uses one reading interface while each format remains independently installable.

---

## Need more than data files?

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

[`@mdgate/data`](https://github.com/mdgate/converters/tree/main/packages/data) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
