# @mdgate/ipynb

**Convert Jupyter notebooks to Markdown in TypeScript.**

[`@mdgate/ipynb`](https://github.com/mdgate/converters/tree/main/packages/ipynb) reads `.ipynb` files directly in JavaScript and converts cells into GitHub-Flavored Markdown, without Python, native addons, WASM, or Jupyter.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/ipynb
```

```ts
import { toMarkdown } from '@mdgate/ipynb';

const markdown = await toMarkdown(bytes);
```

`bytes` is a `Uint8Array`, so the notebook can come from a file upload, object storage, a git checkout, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/ipynb`](https://github.com/mdgate/converters/tree/main/packages/ipynb)

Notebooks mix prose, code, and outputs. Dumping the raw JSON is a poor input for search, RAG, or an agent.

[`@mdgate/ipynb`](https://github.com/mdgate/converters/tree/main/packages/ipynb) is a notebook reader written for the same runtime as your application:

* **Pure TypeScript**
* **Notebook → Markdown locally**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**
* **Detects nbformat JSON from its contents, not only the filename**

---

## What it extracts

[`@mdgate/ipynb`](https://github.com/mdgate/converters/tree/main/packages/ipynb) parses nbformat JSON and rebuilds a shared document model.

The converter handles notebook-specific concerns including:

* markdown cells as Markdown
* code cells as fenced code blocks
* cell outputs that can be represented as text
* cell order

The output is Markdown that can be searched, indexed, chunked, cached, or passed directly to an AI agent.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/ipynb';

const bytes = new Uint8Array(await readFile('analysis.ipynb'));
const markdown = await toMarkdown(bytes);

console.log(markdown);
```

---

## Browser

```ts
import { toMarkdown } from '@mdgate/ipynb';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes);
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/ipynb';

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

[`@mdgate/ipynb`](https://github.com/mdgate/converters/tree/main/packages/ipynb) recognizes Jupyter notebooks from nbformat JSON.

```ts
const markdown = await toMarkdown(bytes);
```

A path can still be supplied as a format hint when [`@mdgate/ipynb`](https://github.com/mdgate/converters/tree/main/packages/ipynb) is used through [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) or a reader composed with [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core), but the path is never used to read a file from disk.

---

## Compose it with other file readers

[`@mdgate/ipynb`](https://github.com/mdgate/converters/tree/main/packages/ipynb) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { ipynb } from '@mdgate/ipynb';
import { html } from '@mdgate/html';

const read = create([
  ipynb(),
  html(),
]);
```

The application still uses one reading interface while each format remains independently installable.

---

## Need more than notebooks?

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

[`@mdgate/ipynb`](https://github.com/mdgate/converters/tree/main/packages/ipynb) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
