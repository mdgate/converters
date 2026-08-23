# mdgate/converters

[![npm](https://img.shields.io/npm/v/@mdgate/converters.svg)](https://www.npmjs.com/package/@mdgate/converters)
[![downloads](https://img.shields.io/npm/dm/@mdgate/converters.svg)](https://www.npmjs.com/package/@mdgate/converters)
[![License: MIT](https://img.shields.io/badge/license-MIT-teal.svg)](LICENSE)
[![convert](https://img.shields.io/badge/convert-convert.mdgate.dev-0f766e)](https://convert.mdgate.dev)

**Pure TypeScript converters for 150+ file types, including DOCX, PDF, PPTX, XLSX, iWork, HWP, and email. Runs in Node, Edge, and browsers.**

**No Python. No native addons. No WASM. No third-party runtime dependencies.**

```bash
npm install @mdgate/converters
```

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/converters';

const bytes = new Uint8Array(await readFile('report.docx'));

const markdown = await toMarkdown(bytes, {
  path: 'report.docx',
});
```

The input is bytes. The output is GitHub-Flavored Markdown. The same call works in Cloudflare Workers, Edge, and the browser.

The optional `path` is a format hint. The converter never reads that path from disk. Formats with a content signature (PDF, DOCX, and many others) can be identified from the bytes alone. CSV and plain text need the hint.

`toMarkdown` is `create(all())`. `all()` registers every converter that needs no configuration. Raster images, audio, and video need callbacks, so they are not in `all()`.

[Convert a file in your browser](https://convert.mdgate.dev): the page runs the library in a Web Worker, so files never leave your machine.

<p align="center">
  <a href="https://convert.mdgate.dev">
    <img src="apps/demo/public/og.png" alt="mdgate/converters: pure TypeScript converters for 150+ file types" width="800" />
  </a>
</p>

---

## One format

If you only need one format, install that converter:

```bash
npm install @mdgate/pdf
```

```ts
import { toMarkdown } from '@mdgate/pdf';

const markdown = await toMarkdown(bytes);
```

Each format package exposes the same `toMarkdown(bytes)` model. The full package list is in [`@mdgate/converters`](packages/converters).

---

## Your own set

```ts
import { create } from '@mdgate/core';
import { pdf } from '@mdgate/pdf';
import { docx } from '@mdgate/docx';
import { xlsx } from '@mdgate/xlsx';

const toMarkdown = create([
  pdf(),
  docx(),
  xlsx(),
]);

const markdown = await toMarkdown(bytes);
```

Archives and containers can pass inner files through the same reader. To add a format, implement `Converter` from [`@mdgate/core`](packages/core).

---

## Supported formats

| Family               | Formats                                                                     |
| -------------------- | --------------------------------------------------------------------------- |
| Microsoft Word       | `.doc`, `.docx`, `.docm`                                                    |
| Microsoft PowerPoint | `.ppt`, `.pps`, `.pot`, `.pptx`, `.pptm`, `.ppsx`, `.ppsm`                  |
| Microsoft Excel      | `.xls`, `.xlsx`, `.xlsm`, `.xlsb`                                           |
| OpenDocument         | `.odt`, `.ods`, `.odp`, `.odg`, templates and flat XML                      |
| Apple iWork          | `.pages`, `.numbers`, `.key`                                                |
| WPS Office           | `.wps`, `.wpt`, `.et`, `.ett`, `.dps`, `.dpt`                               |
| Hangul / Hancom      | `.hwp`, `.hwpx`, `.hwt`, `.hwtx`                                            |
| Rich Text            | `.rtf`                                                                      |
| PDF                  | `.pdf`                                                                      |
| HTML                 | `.html`, `.htm`, `.html4`, `.html5`, `.xhtml`, `.mhtml`, `.mht`             |
| Email                | `.eml`, `.msg`, `.mbox`, `.emlx`                                            |
| Jupyter              | `.ipynb`                                                                    |
| Ebooks               | `.epub`, `.ibooks`, `.fb2`, `.mobi`, `.azw`, `.azw3`, `.prc`                |
| LaTeX                | `.tex`, `.latex`, `.ltx`                                                    |
| Microsoft Visio      | `.vsd`, `.vsdx`, `.vss`, `.vst`, `.vssx`, `.vstx`                           |
| Microsoft OneNote    | `.one`, `.onetoc2`, `.onepkg`                                               |
| Data                 | `.csv`, `.json`, `.jsonl`, `.xml`, `.yaml`                                  |
| Text & source        | `.txt`, `.md`, source-code files                                            |
| Subtitles            | `.srt`, `.vtt`, `.webvtt`, `.ass`, `.lrc`, `.sub`, `.sbv`, `.ttml`, `.jss`  |
| Archives             | `.zip`, `.zipx`, `.jar`                                                     |
| Images               | `.jpeg`\*, `.png`\*, `.webp`\*, `.gif`\*, `.tiff`\*, `.heic`\*, `.bmp`\*, `.svg`, `.svgz` |
| Audio                | `.mp3`\*, `.wav`\*, `.m4a`\*, `.aac`\*, `.ogg`\*, `.flac`\*, `.weba`\*                    |
| Video                | `.mp4`\*, `.m4v`\*, `.mov`\*, `.webm`\*, `.mkv`\*, `.avi`\*                             |

\* Needs a callback: vision for raster images (`image()`), transcription for audio (`audio()`), video understanding for `video()`. Not registered by `all()`. SVG converts locally.

---

## Images, audio, and video

Raster images, audio, and video use the model your application already has. PDF text extracts locally; embedded raster images in a PDF can use the same `image()` callback.

```ts
import { create } from '@mdgate/core';
import { ai } from '@mdgate/ai';
import { image } from '@mdgate/image';
import { audio } from '@mdgate/audio';
import { video } from '@mdgate/video';

const media = ai({
  baseURL: 'https://api.example.com/v1',
  apiKey: process.env.API_KEY!,
  model: 'your-model',
});

const toMarkdown = create([
  image(media.convertImage),
  audio(media.convertAudio),
  video(media.convertVideo),
]);
```

`image()`, `audio()`, and `video()` are not registered by `all()`. SVG converts locally and is included.

---

## Errors

A conversion throws when it cannot produce meaningful Markdown.

```ts
import { ConvertError, toMarkdown } from '@mdgate/converters';

try {
  const markdown = await toMarkdown(bytes, { path: filename });
} catch (error) {
  if (error instanceof ConvertError) {
    console.error(error.code);
  }
}
```

| Code            | Meaning                                     |
| --------------- | ------------------------------------------- |
| `unsupported`   | The format is unknown or unsupported        |
| `malformed`     | No meaningful content could be extracted    |
| `encrypted`     | The file is encrypted or password-protected |
| `missingPart`   | Required document data is missing           |
| `io`            | The input could not be read                 |
| `resourceLimit` | Reserved for resource-limit failures        |

---

## Development

```bash
bun install          # also enables .githooks/pre-commit (lint + test)
bun test
bun run dev:demo
```

A committed fixture corpus under `test/fixtures/` is snapshot-tested. `test/robustness.test.ts` mutation-tests fixtures, and `test/abuse.test.ts` checks that hostile files still convert.

---

## Acknowledgements

The converters are original TypeScript. The projects below were references during development, not runtime dependencies.

- [firecrawl/anydoc](https://github.com/firecrawl/anydoc): early work started as a TypeScript port of this library, then diverged.
- [mozilla/pdf.js](https://github.com/mozilla/pdf.js): layout of PDF standard encoding tables.
- [BurntSushi/rust-csv](https://github.com/BurntSushi/rust-csv): CSV record state machine.
- [mdsteele/rust-cfb](https://github.com/mdsteele/rust-cfb): OLE compound-file FAT checks.
- [ashtuchkin/iconv-lite](https://github.com/ashtuchkin/iconv-lite): single-byte encoding tables.
- [adobe-type-tools/agl-aglfn](https://github.com/adobe-type-tools/agl-aglfn): Adobe Glyph List for PDF glyph names.
- [adobe-type-tools/cmap-resources](https://github.com/adobe-type-tools/cmap-resources): CMap files for PDF CID encodings.
- [adobe-type-tools/mapping-resources-pdf](https://github.com/adobe-type-tools/mapping-resources-pdf): CID-to-Unicode maps for PDF text.
- [Unicode UCD](https://www.unicode.org/Public/UCD/latest/): Equivalent Unified Ideograph mappings.

---

## License

[MIT](LICENSE)
