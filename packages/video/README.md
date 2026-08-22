# @mdgate/video

**Convert video to Markdown in TypeScript.**

[`@mdgate/video`](https://github.com/mdgate/converters/tree/main/packages/video) recognizes MP4, M4V, MOV, WebM, Matroska, and AVI, then hands the whole file to a callback you provide.

It does not ship a video model. `video()` is not registered by `all()`.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/video
```

---

## Why [`@mdgate/video`](https://github.com/mdgate/converters/tree/main/packages/video)

Video is not a document format. Documents that software can parse are handled deterministically. Video understanding needs a model.

This package keeps that split:

```text
video bytes → your callback → Markdown
```

* **Pure TypeScript**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies in this package**
* **Detects common video types from their contents, not only the filename**
* **Not included in `all()`**

---

## What it does

The converter sniffs the video type, then calls your `(input) => markdown` function with `{ bytes, mime }`.

The whole file is passed through. mdgate does not decode, transcode, or extract frames.

Without a callback, conversion fails as unsupported.

---

## Usage

```ts
import { create } from '@mdgate/core';
import { video } from '@mdgate/video';
import { ai } from '@mdgate/ai';

const media = ai({
  baseURL: 'https://api.example.com/v1',
  apiKey: process.env.API_KEY!,
  model: 'your-model',
});

const read = create([
  video(media.convertVideo),
]);

const markdown = await read(bytes, {
  path: 'clip.mp4',
});
```

Or pass any function:

```ts
import { create } from '@mdgate/core';
import { video } from '@mdgate/video';

const read = create([
  video(async (input) => {
    // Send input.bytes to the video model you already use.
    return '...';
  }),
]);
```

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { create } from '@mdgate/core';
import { video } from '@mdgate/video';

const read = create([
  video(convertVideo),
]);

const bytes = new Uint8Array(await readFile('clip.mp4'));
const markdown = await read(bytes, { path: 'clip.mp4' });
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { create } from '@mdgate/core';
import { video } from '@mdgate/video';

const read = create([
  video(convertVideo),
]);

export default {
  async fetch(request: Request) {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const markdown = await read(bytes);

    return new Response(markdown, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
      },
    });
  },
};
```

---

## Need more than video?

If your application needs to read many different file types, use the complete converter set, then add `video()` on top. `all()` does not register it.

```bash
npm install @mdgate/converters
```

[`@mdgate/video`](https://github.com/mdgate/converters/tree/main/packages/video) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
