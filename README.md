# mdgate/converters

[![npm](https://img.shields.io/npm/v/@mdgate/converters.svg)](https://www.npmjs.com/package/@mdgate/converters)
[![downloads](https://img.shields.io/npm/dm/@mdgate/converters.svg)](https://www.npmjs.com/package/@mdgate/converters)
[![License: MIT](https://img.shields.io/badge/license-MIT-teal.svg)](LICENSE)
[![convert](https://img.shields.io/badge/convert-convert.mdgate.dev-0f766e)](https://convert.mdgate.dev)

**Real-world files to Markdown, in pure TypeScript.**

Convert PDF, Word, Excel, PowerPoint, OpenDocument, Apple iWork, HWP, WPS, email, OneNote, Visio, ebooks, archives, and more into GitHub-Flavored Markdown.

Runs in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

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

[Try it in your browser](https://convert.mdgate.dev). Files convert locally and never leave your machine.

<p align="center">
  <a href="https://convert.mdgate.dev">
    <img src="apps/demo/public/og.png" alt="mdgate/converters: real-world files to Markdown, in pure TypeScript" width="800" />
  </a>
</p>

---

## Why mdgate/converters?

A JavaScript application that needs to read real-world files quickly becomes a collection of unrelated parsers and runtimes.

PDF needs one solution. Word needs another. Then Excel, PowerPoint, email, Apple Pages, HWP, OneNote, Visio, ebooks, archives...

`mdgate/converters` puts them behind one interface:

```text
Uint8Array → Markdown
```

It is designed to stay inside the JavaScript runtime your application already uses.

* **Broad format coverage**: Office, PDF, iWork, HWP, WPS, email, ebooks, notebooks, archives, and more
* **Portable TypeScript**: Node.js, Cloudflare Workers, Edge, and browser
* **Local parsing**: deterministic formats are parsed without a remote conversion service
* **One Markdown dialect**: official converters produce consistent GitHub-Flavored Markdown
* **Content-based detection**: many formats are identified from their bytes, not just their extension
* **Composable**: install every converter, one format, or your own combination
* **Nested conversion**: archives and container formats can pass inner files through the same reader
* **Small supply chain**: no third-party runtime dependencies, native addons, or WASM

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

Each format package exposes the same `toMarkdown(bytes)` model.

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

| Family               | Formats                                                                                          | Package |
| -------------------- | ------------------------------------------------------------------------------------------------ | ------- |
| Microsoft Word       | `.doc`, `.docx`, `.docm`                                                                         | [`@mdgate/doc`](packages/doc), [`@mdgate/docx`](packages/docx) |
| Microsoft PowerPoint | `.ppt`, `.pps`, `.pot`, `.pptx`, `.pptm`, `.ppsx`, `.ppsm`                                       | [`@mdgate/ppt`](packages/ppt), [`@mdgate/pptx`](packages/pptx) |
| Microsoft Excel      | `.xls`, `.xlsx`, `.xlsm`, `.xlsb`                                                                | [`@mdgate/xlsx`](packages/xlsx) |
| OpenDocument         | `.odt`, `.ods`, `.odp`, `.odg`, templates and flat XML                                           | [`@mdgate/odf`](packages/odf) |
| Apple iWork          | `.pages`, `.numbers`, `.key`                                                                     | [`@mdgate/pages`](packages/pages), [`@mdgate/numbers`](packages/numbers), [`@mdgate/keynote`](packages/keynote) |
| WPS Office           | `.wps`, `.wpt`, `.et`, `.ett`, `.dps`, `.dpt`                                                    | [`@mdgate/wps`](packages/wps) |
| Hangul / Hancom      | `.hwp`, `.hwpx`, `.hwt`, `.hwtx`                                                                 | [`@mdgate/hwp`](packages/hwp) |
| Rich Text            | `.rtf`                                                                                           | [`@mdgate/rtf`](packages/rtf) |
| PDF                  | `.pdf`                                                                                           | [`@mdgate/pdf`](packages/pdf) |
| HTML                 | `.html`, `.htm`, `.html4`, `.html5`, `.xhtml`, `.mhtml`, `.mht`                                  | [`@mdgate/html`](packages/html) |
| Email                | `.eml`, `.msg`, `.mbox`, `.emlx`                                                                 | [`@mdgate/email`](packages/email) |
| Jupyter              | `.ipynb`                                                                                         | [`@mdgate/ipynb`](packages/ipynb) |
| Ebooks               | `.epub`, `.ibooks`, `.fb2`, `.mobi`, `.azw`, `.azw3`, `.prc`                                     | [`@mdgate/epub`](packages/epub), [`@mdgate/fb2`](packages/fb2), [`@mdgate/mobi`](packages/mobi) |
| LaTeX                | `.tex`, `.latex`, `.ltx`                                                                         | [`@mdgate/latex`](packages/latex) |
| Microsoft Visio      | `.vsd`, `.vsdx`, `.vss`, `.vst`, `.vssx`, `.vstx`                                                | [`@mdgate/visio`](packages/visio) |
| Microsoft OneNote    | `.one`, `.onetoc2`, `.onepkg`                                                                    | [`@mdgate/onenote`](packages/onenote) |
| Data                 | `.csv`, `.json`, `.jsonl`, `.xml`, `.yaml`                                                       | [`@mdgate/csv`](packages/csv), [`@mdgate/data`](packages/data) |
| Text & source        | `.txt`, `.md`, source-code files                                                                 | [`@mdgate/text`](packages/text) |
| Subtitles            | `.srt`, `.vtt`, `.webvtt`, `.ass`, `.lrc`, `.sub`, `.sbv`, `.ttml`, `.jss`                       | [`@mdgate/subtitle`](packages/subtitle) |
| Archives             | `.zip`, `.zipx`, `.jar`                                                                          | [`@mdgate/zip`](packages/zip) |
| Images               | `.jpeg`\*, `.png`\*, `.webp`\*, `.gif`\*, `.tiff`\*, `.heic`\*, `.bmp`\*, `.svg`, `.svgz`        | [`@mdgate/image`](packages/image) |
| Audio                | `.mp3`\*, `.wav`\*, `.m4a`\*, `.aac`\*, `.ogg`\*, `.flac`\*, `.weba`\*                           | [`@mdgate/audio`](packages/audio) |
| Video                | `.mp4`\*, `.m4v`\*, `.mov`\*, `.webm`\*, `.mkv`\*, `.avi`\*                                      | [`@mdgate/video`](packages/video) |

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
