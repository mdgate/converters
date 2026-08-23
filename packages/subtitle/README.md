# @mdgate/subtitle

**Convert subtitle files to Markdown in TypeScript.**

[`@mdgate/subtitle`](https://github.com/mdgate/converters/tree/main/packages/subtitle) reads caption files directly in JavaScript and converts cues into GitHub-Flavored Markdown, without Python, native addons, WASM, or a media player.

Handles `.srt`, `.vtt`, `.webvtt`, `.ass`, `.ssa`, `.lrc`, `.sub` (MicroDVD), `.sbv`, `.ttml`, and `.jss`.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/subtitle
```

```ts
import { toMarkdown } from '@mdgate/subtitle';

const markdown = await toMarkdown(bytes);
```

`bytes` is a `Uint8Array`, so the file can come from a file upload, object storage, an HTTP request, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/subtitle`](https://github.com/mdgate/converters/tree/main/packages/subtitle)

Subtitles are already a transcript. Converting them to Markdown lets an agent search, chunk, and cite spoken content without a video pipeline.

* **Pure TypeScript**
* **Subtitles → Markdown locally**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**

---

## What it extracts

[`@mdgate/subtitle`](https://github.com/mdgate/converters/tree/main/packages/subtitle) parses cue timing and text, strips format-specific markup, and rebuilds a shared document model.

The converter handles subtitle-specific concerns including:

* SRT and WebVTT timing
* ASS / SSA dialogue lines
* LRC lyrics
* MicroDVD `.sub`
* YouTube `.sbv`
* TTML
* Jacosub `.jss`
* italic and other simple emphasis when the format carries it

The output is Markdown that can be searched, indexed, chunked, cached, or passed directly to an AI agent.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/subtitle';

const bytes = new Uint8Array(await readFile('talk.srt'));
const markdown = await toMarkdown(bytes);

console.log(markdown);
```

---

## Browser

```ts
import { toMarkdown } from '@mdgate/subtitle';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes);
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/subtitle';

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

Many subtitle formats can be recognized from their contents. A path hint still helps for ambiguous text files.

The path is never used to read a file from disk.

---

## Compose it with other file readers

[`@mdgate/subtitle`](https://github.com/mdgate/converters/tree/main/packages/subtitle) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { subtitle } from '@mdgate/subtitle';
import { text } from '@mdgate/text';

const read = create([
  subtitle(),
  text(),
]);
```

The application still uses one reading interface while each format remains independently installable.

---

## Need more than subtitles?

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

[`@mdgate/subtitle`](https://github.com/mdgate/converters/tree/main/packages/subtitle) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
