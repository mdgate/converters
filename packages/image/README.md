# @mdgate/image

**Convert images to Markdown in TypeScript.**

[`@mdgate/image`](https://github.com/mdgate/converters/tree/main/packages/image) handles JPEG, PNG, WebP, GIF, TIFF, HEIC, BMP, SVG, and gzip SVG (`.svgz`).

SVG is converted locally. Raster formats need a vision callback you provide. They are not registered by `all()`.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/image
```

---

## SVG, locally

`toMarkdown` on this package is the local SVG converter.

```ts
import { toMarkdown } from '@mdgate/image';

const markdown = await toMarkdown(bytes);
```

No Python, native addons, WASM, or vision API is required for SVG.

---

## Raster images

Raster images are a different problem from DOCX or PDF. mdgate does not pick an OCR vendor.

Connect the model your application already uses:

```ts
import { create } from '@mdgate/core';
import { image } from '@mdgate/image';
import { ai } from '@mdgate/ai';
import { pdf } from '@mdgate/pdf';

const media = ai({
  baseURL: 'https://api.example.com/v1',
  apiKey: process.env.API_KEY!,
  model: 'your-vision-model',
});

const read = create([
  pdf(),
  image(media.convertImage),
]);
```

Or pass any `(input) => markdown` function. The callback receives `{ bytes, mime, page }`.

`image()` is not included in `all()`. `svg()` is.

---

## Why [`@mdgate/image`](https://github.com/mdgate/converters/tree/main/packages/image)

This package exists so images can join the same converter registry as documents.

* **Pure TypeScript**
* **SVG → Markdown locally**
* **Raster images via your callback**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies in this package**
* **Detects common image types from their contents, not only the filename**

When composed with [`@mdgate/pdf`](https://github.com/mdgate/converters/tree/main/packages/pdf), embedded PDF images can be handed back into this converter.

---

## What it extracts

**SVG / SVGZ:**

* titles and visible text from the SVG

**Raster (JPEG, PNG, WebP, GIF, TIFF, HEIC, BMP):**

* whatever Markdown your callback returns

mdgate does not silently send every image to a remote model. You register the callback.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { create } from '@mdgate/core';
import { image } from '@mdgate/image';

const read = create([
  image(async (input) => {
    // Send input.bytes to the vision model you already use.
    return '...';
  }),
]);

const bytes = new Uint8Array(await readFile('scan.png'));
const markdown = await read(bytes, { path: 'scan.png' });
```

---

## Browser

```ts
import { create } from '@mdgate/core';
import { image, svg } from '@mdgate/image';

const read = create([
  svg(),
  image(convertImage),
]);

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());
const markdown = await read(bytes, { path: file.name });
```

---

## Compose it with other file readers

[`@mdgate/image`](https://github.com/mdgate/converters/tree/main/packages/image) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { image } from '@mdgate/image';
import { pdf } from '@mdgate/pdf';

const read = create([
  pdf(),
  image(convertImage),
]);
```

The application still uses one reading interface while each format remains independently installable.

---

## Need more than images?

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

Raster image conversion still needs `image()` composed on top of `all()`, because `all()` does not register it.

[`@mdgate/image`](https://github.com/mdgate/converters/tree/main/packages/image) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
