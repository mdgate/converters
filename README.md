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
import { toMarkdown } from '@mdgate/converters';

const markdown = await toMarkdown(bytes, {
  path: 'report.docx',
});
```

Bytes in. GitHub-Flavored Markdown out. Works in Node.js, Cloudflare Workers, Edge, and browsers.

[Try it in your browser](https://convert.mdgate.dev). Files convert locally and never leave your machine.

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

`@mdgate/converters` is `create(all())`. The optional `path` is a format hint, never a disk read. Archives pass inner files through the same reader. To add a format, implement `Converter` from [`@mdgate/core`](packages/core).

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

Raster images, audio, and video use callbacks, so you can plug in the vision or transcription model you already use. See [`@mdgate/ai`](packages/ai) for an OpenAI-compatible adapter.

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
