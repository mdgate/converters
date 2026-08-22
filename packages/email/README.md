# @mdgate/email

**Convert email messages to Markdown in TypeScript.**

[`@mdgate/email`](https://github.com/mdgate/converters/tree/main/packages/email) reads `.eml`, `.msg`, `.mbox`, and `.emlx` files directly in JavaScript and converts them into GitHub-Flavored Markdown, without Python, native addons, WASM, or an email client.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/email
```

```ts
import { toMarkdown } from '@mdgate/email';

const markdown = await toMarkdown(bytes);
```

`bytes` is a `Uint8Array`, so the message can come from a file upload, object storage, an IMAP export, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/email`](https://github.com/mdgate/converters/tree/main/packages/email)

Email is a container: headers, a text or HTML body, and attachments. Agents need the message as text they can search and cite.

[`@mdgate/email`](https://github.com/mdgate/converters/tree/main/packages/email) is an email reader written for the same runtime as your application:

* **Pure TypeScript**
* **Email → Markdown locally**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**
* **Detects RFC 822 mail and Outlook MSG from their contents, not only the filename**

---

## What it extracts

[`@mdgate/email`](https://github.com/mdgate/converters/tree/main/packages/email) parses MIME messages, Apple EMLX, mbox, and Outlook MSG (OLE).

The converter handles email-specific concerns including:

* Subject as a heading
* From, To, Cc, and Date
* HTML bodies converted through the same HTML document model
* plain-text bodies
* attachment names listed under an Attachments heading
* Outlook `.msg` compound files

Standalone conversion lists attachment names. Nested conversion of those attachments happens when the message sits inside a composed reader that also has converters for those formats (for example a ZIP of `.eml` files handled by [`@mdgate/zip`](https://github.com/mdgate/converters/tree/main/packages/zip)).

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/email';

const bytes = new Uint8Array(await readFile('note.eml'));
const markdown = await toMarkdown(bytes);

console.log(markdown);
```

---

## Browser

```ts
import { toMarkdown } from '@mdgate/email';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes);
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/email';

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

RFC 822 messages are recognized from headers. Outlook MSG is recognized from OLE streams.

```ts
const markdown = await toMarkdown(bytes);
```

A path can still be supplied as a format hint when [`@mdgate/email`](https://github.com/mdgate/converters/tree/main/packages/email) is used through [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) or a reader composed with [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core), but the path is never used to read a file from disk.

---

## Compose it with other file readers

[`@mdgate/email`](https://github.com/mdgate/converters/tree/main/packages/email) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { email } from '@mdgate/email';
import { html } from '@mdgate/html';
import { zip } from '@mdgate/zip';

const read = create([
  email(),
  html(),
  zip(),
]);
```

The application still uses one reading interface while each format remains independently installable.

---

## Need more than email?

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

[`@mdgate/email`](https://github.com/mdgate/converters/tree/main/packages/email) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
