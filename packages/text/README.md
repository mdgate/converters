# @mdgate/text

**Convert text, Markdown, and source files in TypeScript.**

[`@mdgate/text`](https://github.com/mdgate/converters/tree/main/packages/text) reads `.txt`, `.md`, and common source-code files directly in JavaScript and returns GitHub-Flavored Markdown, without Python, native addons, or an extra toolchain.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/text
```

```ts
import { toMarkdown } from '@mdgate/text';

const markdown = await toMarkdown(bytes, {
  path: 'notes.txt',
});
```

`bytes` is a `Uint8Array`, so the file can come from a file upload, object storage, a git checkout, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/text`](https://github.com/mdgate/converters/tree/main/packages/text)

Plain text and source files still need to join the same reader as DOCX and PDF. This converter is that path.

* **Pure TypeScript**
* **Local conversion**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**
* **Uses a path hint, because these formats have no reliable file signature**

---

## What it extracts

* `.txt` / `.text`: paragraphs
* `.md` / `.markdown` / `.mdx`: passed through as Markdown
* source extensions (`.js`, `.ts`, `.py`, `.go`, `.rs`, and similar): wrapped in a fenced code block

The path selects the treatment. It is never used to read a file from disk.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/text';

const bytes = new Uint8Array(await readFile('notes.txt'));
const markdown = await toMarkdown(bytes, {
  path: 'notes.txt',
});

console.log(markdown);
```

---

## Browser

```ts
import { toMarkdown } from '@mdgate/text';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes, {
  path: file.name,
});
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/text';

export default {
  async fetch(request: Request) {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const markdown = await toMarkdown(bytes, {
      path: request.headers.get('x-filename') ?? 'upload.txt',
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

## Compose it with other file readers

[`@mdgate/text`](https://github.com/mdgate/converters/tree/main/packages/text) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { text } from '@mdgate/text';
import { html } from '@mdgate/html';

const read = create([
  text(),
  html(),
]);
```

The application still uses one reading interface while each format remains independently installable.

---

## Need more than text?

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

[`@mdgate/text`](https://github.com/mdgate/converters/tree/main/packages/text) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
