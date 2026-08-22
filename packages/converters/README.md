# @mdgate/converters

**Real-world files to Markdown, in pure TypeScript.**

[`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) is the complete deterministic reader: one `toMarkdown(bytes)` for PDF, Word, Excel, PowerPoint, OpenDocument, Apple iWork, HWP, WPS, email, OneNote, Visio, ebooks, archives, and more.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

**No Python. No native addons. No WASM. No third-party runtime dependencies.**

```bash
npm install @mdgate/converters
```

```ts
import { toMarkdown } from '@mdgate/converters';

const markdown = await toMarkdown(bytes, {
  path: 'report.docx',
});
```

The input is bytes. The output is Markdown.

[Convert a file in your browser](https://convert.mdgate.dev). Full docs live in the [repository README](https://github.com/mdgate/converters#readme).

---

## Why [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters)

A JavaScript application that needs to read real-world files quickly becomes a collection of unrelated parsers.

This package puts them behind one interface:

```text
Uint8Array → Markdown
```

`toMarkdown` is `create(all())`. `all()` registers every converter that needs no configuration. Raster images, audio, and video need callbacks, so they are exported but not included in `all()`.

---

## One format

If your application only needs one format, install only that converter.

```bash
npm install @mdgate/pdf
```

```ts
import { toMarkdown } from '@mdgate/pdf';

const markdown = await toMarkdown(bytes);
```

---

## Your own set

```ts
import { create } from '@mdgate/core';
import { pdf } from '@mdgate/pdf';
import { docx } from '@mdgate/docx';
import { xlsx } from '@mdgate/xlsx';

const read = create([
  pdf(),
  docx(),
  xlsx(),
]);
```

Or start from `all()` and add media callbacks:

```ts
import { all, create, image } from '@mdgate/converters';
import { ai } from '@mdgate/ai';

const media = ai({
  baseURL: 'https://api.example.com/v1',
  apiKey: process.env.API_KEY!,
  model: 'your-model',
});

const read = create([
  ...all(),
  image(media.convertImage),
]);
```

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/converters';

const bytes = new Uint8Array(await readFile('report.docx'));
const markdown = await toMarkdown(bytes, {
  path: 'report.docx',
});
```

The optional `path` is a format hint. The converter never reads that path from disk.

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/converters';

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

## Browser

```ts
import { toMarkdown } from '@mdgate/converters';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes, {
  path: file.name,
});
```

[Try it in your browser](https://convert.mdgate.dev)

---

## Packages

| Package | Handles |
|---|---|
| [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) | Bundle: every deterministic format below, `toMarkdown`, `all()` |
| [`@mdgate/docx`](https://github.com/mdgate/converters/tree/main/packages/docx) | docx, docm |
| [`@mdgate/doc`](https://github.com/mdgate/converters/tree/main/packages/doc) | doc (binary Word) |
| [`@mdgate/rtf`](https://github.com/mdgate/converters/tree/main/packages/rtf) | rtf |
| [`@mdgate/pptx`](https://github.com/mdgate/converters/tree/main/packages/pptx) | pptx, pptm, ppsx, ppsm |
| [`@mdgate/ppt`](https://github.com/mdgate/converters/tree/main/packages/ppt) | ppt, pps, pot (binary PowerPoint) |
| [`@mdgate/xlsx`](https://github.com/mdgate/converters/tree/main/packages/xlsx) | xlsx, xlsm, xlsb, xls |
| [`@mdgate/csv`](https://github.com/mdgate/converters/tree/main/packages/csv) | csv |
| [`@mdgate/text`](https://github.com/mdgate/converters/tree/main/packages/text) | txt, md, and source files |
| [`@mdgate/data`](https://github.com/mdgate/converters/tree/main/packages/data) | json, jsonl, xml, yaml |
| [`@mdgate/subtitle`](https://github.com/mdgate/converters/tree/main/packages/subtitle) | srt, vtt, webvtt, ass, lrc, sub, sbv, ttml, jss |
| [`@mdgate/html`](https://github.com/mdgate/converters/tree/main/packages/html) | html, htm, html4, html5, xhtml, mhtml, mht |
| [`@mdgate/email`](https://github.com/mdgate/converters/tree/main/packages/email) | eml, msg, mbox, emlx |
| [`@mdgate/ipynb`](https://github.com/mdgate/converters/tree/main/packages/ipynb) | ipynb (Jupyter) |
| [`@mdgate/odf`](https://github.com/mdgate/converters/tree/main/packages/odf) | odt, ods, odp, odg |
| [`@mdgate/pages`](https://github.com/mdgate/converters/tree/main/packages/pages) | pages |
| [`@mdgate/numbers`](https://github.com/mdgate/converters/tree/main/packages/numbers) | numbers |
| [`@mdgate/keynote`](https://github.com/mdgate/converters/tree/main/packages/keynote) | key |
| [`@mdgate/epub`](https://github.com/mdgate/converters/tree/main/packages/epub) | epub, ibooks |
| [`@mdgate/pdf`](https://github.com/mdgate/converters/tree/main/packages/pdf) | pdf |
| [`@mdgate/fb2`](https://github.com/mdgate/converters/tree/main/packages/fb2) | fb2, fb2.zip |
| [`@mdgate/mobi`](https://github.com/mdgate/converters/tree/main/packages/mobi) | mobi, azw, azw3, prc |
| [`@mdgate/latex`](https://github.com/mdgate/converters/tree/main/packages/latex) | tex, latex, ltx |
| [`@mdgate/visio`](https://github.com/mdgate/converters/tree/main/packages/visio) | vsd, vsdx, vss, vst, vssx, vstx |
| [`@mdgate/onenote`](https://github.com/mdgate/converters/tree/main/packages/onenote) | one, onetoc2, onepkg |
| [`@mdgate/hwp`](https://github.com/mdgate/converters/tree/main/packages/hwp) | hwp, hwpx, hwt, hwtx |
| [`@mdgate/wps`](https://github.com/mdgate/converters/tree/main/packages/wps) | wps, wpt, et, ett, dps, dpt |
| [`@mdgate/zip`](https://github.com/mdgate/converters/tree/main/packages/zip) | zip, zipx, jar |
| [`@mdgate/image`](https://github.com/mdgate/converters/tree/main/packages/image) | jpeg\*, png\*, webp\*, gif\*, tiff\*, heic\*, bmp\*, svg, svgz |
| [`@mdgate/audio`](https://github.com/mdgate/converters/tree/main/packages/audio) | mp3\*, wav\*, m4a\*, aac\*, ogg\*, flac\*, weba\* |
| [`@mdgate/video`](https://github.com/mdgate/converters/tree/main/packages/video) | mp4\*, m4v\*, mov\*, webm\*, mkv\*, avi\* |

\* Needs a callback: vision for raster images (`image()`), transcription for audio (`audio()`), video understanding for `video()`. Not registered by `all()`. SVG converts locally.

[`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) is the complete reader in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
