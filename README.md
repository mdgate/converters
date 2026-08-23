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
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/converters';

const bytes = new Uint8Array(await readFile('report.docx'));

const markdown = await toMarkdown(bytes, {
  path: 'report.docx',
});
```

The input is bytes. The output is Markdown.

Use it for AI agents, document ingestion, search and indexing, RAG pipelines, local file processing, or any JavaScript application that needs to read files people actually use.

[Convert a file in your browser](https://convert.mdgate.dev): the page runs the library in a Web Worker, so files are converted locally and never leave your machine.

<p align="center">
  <a href="https://convert.mdgate.dev">
    <img src="apps/demo/public/og.png" alt="mdgate/converters: any file in, Markdown out" width="800" />
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

## Quick start

### Everything

Install the complete deterministic converter set:

```bash
npm install @mdgate/converters
```

```ts
import { toMarkdown } from '@mdgate/converters';

const markdown = await toMarkdown(bytes, {
  path: 'document.docx',
});
```

The optional `path` is a format hint. The converter never reads that path from disk.

For formats with recognizable content signatures (such as PDF, DOCX, PPTX, XLSX, HWP, and many others), the bytes themselves can identify the format.

Formats such as CSV and plain text need a path hint because their contents do not have a reliable file signature.

`toMarkdown` from [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) is `create(all())`. `all()` registers every converter that needs no configuration. Raster images, audio, and video need callbacks, so they are not in `all()`.

---

### One format

If your application only needs one format, install only that converter.

```bash
npm install @mdgate/pdf
```

```ts
import { toMarkdown } from '@mdgate/pdf';

const markdown = await toMarkdown(bytes);
```

Or:

```bash
npm install @mdgate/docx
npm install @mdgate/pptx
npm install @mdgate/xlsx
npm install @mdgate/hwp
npm install @mdgate/pages
```

Each format package exposes the same `toMarkdown(bytes)` model.

---

### Your own set

Build exactly the reader your application needs:

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

This is useful when bundle size or deployment surface matters, especially in Edge and serverless environments.

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

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/converters';

const bytes = new Uint8Array(
  await readFile('presentation.pptx'),
);

const markdown = await toMarkdown(bytes, {
  path: 'presentation.pptx',
});
```

The converter itself operates on bytes, so files do not need to come from the local filesystem.

They can come from S3, R2, Google Drive, an upload, an email attachment, an API request, or any other source.

---

## Cloudflare Workers

`mdgate/converters` runs directly inside Cloudflare Workers.

```ts
import { toMarkdown } from '@mdgate/converters';

export default {
  async fetch(request: Request) {
    const file = await request.arrayBuffer();

    const markdown = await toMarkdown(
      new Uint8Array(file),
      {
        path: request.headers.get('x-filename') ?? undefined,
      },
    );

    return new Response(markdown, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
      },
    });
  },
};
```

No Python sidecar, native executable, WASM runtime, or document-conversion server is required.

---

## Browser

The same converters can run locally in the browser.

```ts
import { toMarkdown } from '@mdgate/converters';

const file = input.files![0];

const bytes = new Uint8Array(
  await file.arrayBuffer(),
);

const markdown = await toMarkdown(bytes, {
  path: file.name,
});
```

For locally supported formats, the file can stay entirely on the user's device.

[Try it in your browser](https://convert.mdgate.dev)

---

## Built for agents

A coding or AI agent usually does not need another document-processing platform.

It needs the contents of a file in a form it can work with.

```text
DOCX
XLSX
PPTX
PDF
HWP
Pages
MSG
OneNote
...
   ↓
mdgate/converters
   ↓
Markdown
   ↓
grep / search / chunk / index / cite / reason
```

Once a binary document becomes Markdown, the rest of the agent can use the same text tools it already has.

For example:

```ts
import { toMarkdown } from '@mdgate/converters';

async function readFileForAgent(
  bytes: Uint8Array,
  filename: string,
) {
  return toMarkdown(bytes, {
    path: filename,
  });
}
```

The agent does not need to know which parser handles each file format.

---

## Consistent Markdown

Official converters share a common Markdown representation where applicable.

Supported document structure includes:

* headings
* paragraphs
* bold, italic, and strikethrough
* links
* inline code and code blocks
* ordered and unordered lists
* nested lists
* tables
* block quotes
* footnotes and endnotes
* presentation speaker notes

The exact structure available depends on the source format and the information present in the file.

---

## Content-based format detection

File extensions are useful, but they are not always trustworthy.

mdgate converters can inspect the file itself:

```text
PDF header
OLE streams
ZIP package metadata
RTF structure
container contents
...
```

Converters compete by sniff score:

* content signature: stronger match
* extension/path hint: weaker match

This means a mislabeled file can still be routed to the right converter when its contents identify the real format.

```ts
const markdown = await toMarkdown(bytes);
```

For signature-less formats:

```ts
const markdown = await toMarkdown(bytes, {
  path: 'records.csv',
});
```

---

## Nested files

Container formats can send their contents back through the same converter registry.

For example:

```text
archive.zip
└── email.eml
    └── attachment.docx
        └── Markdown
```

The ZIP converter does not need to know how DOCX works.

It hands the nested bytes back to the same reader.

---

## How it works

```
file bytes
  │
  └─► convert
        ├─► sniff              → each converter scores the bytes (and optional path)
        ├─► parser             → Markdown
        │         └─► Document → GFM serializer   (optional)
        └─► nested convert     → zip / eml / … can hand inner bytes back
```

The contract is sniff plus Markdown. A parser may build a `Document` and run the shared GFM serializer, so a table-escaping fix applies to every format on that helper. A parser may also hand inner bytes back to `convert`.

---

## PDF and embedded images

PDF text is extracted locally.

If a PDF contains embedded raster images that need visual understanding, those images can be handed back to the converter pool.

Register an image converter with a vision callback when you need that behavior.

```ts
import { create } from '@mdgate/core';
import { pdf } from '@mdgate/pdf';
import { image } from '@mdgate/image';

const toMarkdown = create([
  pdf(),
  image(async (input) => {
    // Send the image to the vision model you already use.
    return '...';
  }),
]);
```

mdgate does not force a particular OCR or vision provider.

---

## Images, audio, and video

Structured document formats and multimodal media are different problems.

Documents that software can parse are handled deterministically.

For raster images, audio, and video, connect the model your application already uses:

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

This keeps mdgate out of the business of introducing a second AI stack into your application.

`image()`, `audio()`, and `video()` are not registered by `all()`. SVG converts locally and is included.

---

## Errors

A conversion throws when meaningful Markdown cannot be produced.

```ts
import {
  ConvertError,
  toMarkdown,
} from '@mdgate/converters';

try {
  const markdown = await toMarkdown(bytes, {
    path: filename,
  });
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

## Packages

### Complete reader

| Package              | Purpose                                              |
| -------------------- | ---------------------------------------------------- |
| [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) | All deterministic converters with one `toMarkdown()`, plus `all()` |

### Documents

| Package           | Formats                     |
| ----------------- | --------------------------- |
| [`@mdgate/pdf`](https://github.com/mdgate/converters/tree/main/packages/pdf)     | PDF                         |
| [`@mdgate/docx`](https://github.com/mdgate/converters/tree/main/packages/docx)    | DOCX, DOCM                  |
| [`@mdgate/doc`](https://github.com/mdgate/converters/tree/main/packages/doc)     | Legacy Word DOC             |
| [`@mdgate/rtf`](https://github.com/mdgate/converters/tree/main/packages/rtf)     | RTF                         |
| [`@mdgate/pptx`](https://github.com/mdgate/converters/tree/main/packages/pptx)    | PPTX, PPTM, PPSX, PPSM      |
| [`@mdgate/ppt`](https://github.com/mdgate/converters/tree/main/packages/ppt)     | Legacy PPT, PPS, POT        |
| [`@mdgate/xlsx`](https://github.com/mdgate/converters/tree/main/packages/xlsx)    | XLSX, XLSM, XLSB, XLS       |
| [`@mdgate/odf`](https://github.com/mdgate/converters/tree/main/packages/odf)     | ODT, ODS, ODP, ODG          |
| [`@mdgate/pages`](https://github.com/mdgate/converters/tree/main/packages/pages)   | Apple Pages                 |
| [`@mdgate/numbers`](https://github.com/mdgate/converters/tree/main/packages/numbers) | Apple Numbers               |
| [`@mdgate/keynote`](https://github.com/mdgate/converters/tree/main/packages/keynote) | Apple Keynote               |
| [`@mdgate/hwp`](https://github.com/mdgate/converters/tree/main/packages/hwp)     | HWP, HWPX, HWT, HWTX        |
| [`@mdgate/wps`](https://github.com/mdgate/converters/tree/main/packages/wps)     | WPS, WPT, ET, ETT, DPS, DPT |
| [`@mdgate/visio`](https://github.com/mdgate/converters/tree/main/packages/visio)   | Visio                       |
| [`@mdgate/onenote`](https://github.com/mdgate/converters/tree/main/packages/onenote) | OneNote                     |
| [`@mdgate/html`](https://github.com/mdgate/converters/tree/main/packages/html)    | HTML, XHTML, MHTML          |
| [`@mdgate/email`](https://github.com/mdgate/converters/tree/main/packages/email)   | EML, MSG, MBOX, EMLX        |
| [`@mdgate/ipynb`](https://github.com/mdgate/converters/tree/main/packages/ipynb)   | Jupyter Notebook            |
| [`@mdgate/latex`](https://github.com/mdgate/converters/tree/main/packages/latex)   | LaTeX                       |

### Ebooks

| Package        | Formats              |
| -------------- | -------------------- |
| [`@mdgate/epub`](https://github.com/mdgate/converters/tree/main/packages/epub) | EPUB, iBooks         |
| [`@mdgate/fb2`](https://github.com/mdgate/converters/tree/main/packages/fb2)  | FB2, FB2.ZIP         |
| [`@mdgate/mobi`](https://github.com/mdgate/converters/tree/main/packages/mobi) | MOBI, AZW, AZW3, PRC |

### Text and data

| Package            | Formats                     |
| ------------------ | --------------------------- |
| [`@mdgate/csv`](https://github.com/mdgate/converters/tree/main/packages/csv)      | CSV                         |
| [`@mdgate/data`](https://github.com/mdgate/converters/tree/main/packages/data)     | JSON, JSONL, XML, YAML      |
| [`@mdgate/text`](https://github.com/mdgate/converters/tree/main/packages/text)     | Text, Markdown, source code |
| [`@mdgate/subtitle`](https://github.com/mdgate/converters/tree/main/packages/subtitle) | Subtitle formats            |

### Containers and media

| Package         | Purpose                              |
| --------------- | ------------------------------------ |
| [`@mdgate/zip`](https://github.com/mdgate/converters/tree/main/packages/zip)   | ZIP, ZIPX, JAR and nested conversion |
| [`@mdgate/image`](https://github.com/mdgate/converters/tree/main/packages/image) | Image conversion                     |
| [`@mdgate/audio`](https://github.com/mdgate/converters/tree/main/packages/audio) | Audio conversion                     |
| [`@mdgate/video`](https://github.com/mdgate/converters/tree/main/packages/video) | Video conversion                     |
| [`@mdgate/ai`](https://github.com/mdgate/converters/tree/main/packages/ai)    | Optional multimodal callbacks        |

Raster images, audio, and video need a callback and are not registered by `all()`. SVG converts locally.

### Composition

| Package            | Purpose                                     |
| ------------------ | ------------------------------------------- |
| [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core)     | `create()`, converter interface, errors     |
| [`@mdgate/document`](https://github.com/mdgate/converters/tree/main/packages/document) | Shared document model and Markdown renderer |

### Internal

| Package                 | Role                                        |
| ----------------------- | ------------------------------------------- |
| [`@mdgate/containers`](https://github.com/mdgate/converters/tree/main/packages/containers)    | ZIP/OPC, OLE (CFB), XML parsing             |
| [`@mdgate/office-common`](https://github.com/mdgate/converters/tree/main/packages/office-common) | Shared office-format semantics              |
| [`@mdgate/iwork-common`](https://github.com/mdgate/converters/tree/main/packages/iwork-common)  | Apple iWork IWA / Snappy / protobuf helpers |
| [`@mdgate/utils`](https://github.com/mdgate/converters/tree/main/packages/utils)         | Text, byte, inflate, encoding helpers       |

---

## Write your own converter

The supported format list does not need to be the limit of your reader.

A converter only needs to identify its input and return Markdown:

```ts
import type { Converter } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';

export function myFormat(): Converter {
  return {
    id: 'my-format',

    sniff(bytes) {
      return looksLikeMyFormat(bytes) ? 2 : 0;
    },

    convert(bytes) {
      return {
        markdown: documentToMarkdown(
          parseMyFormat(bytes),
        ),
      };
    },
  };
}
```

Then compose it with official converters:

```ts
import { create } from '@mdgate/core';
import { pdf } from '@mdgate/pdf';
import { docx } from '@mdgate/docx';

const toMarkdown = create([
  myFormat(),
  pdf(),
  docx(),
]);
```

Converters registered with `create()` compete by sniff score. Content signatures (score 2) outrank extension hints (score 1).

This is useful for proprietary enterprise formats, internal exports, industry-specific files, or formats not yet included in the repository.

---

## Development

```bash
bun install          # also enables .githooks/pre-commit (lint + test)
bun test
bun run dev:demo
```

A committed fixture corpus under `test/fixtures/` is snapshot-tested. `test/robustness.test.ts` mutation-tests fixtures, and `test/abuse.test.ts` checks that hostile files still convert.

---

## License

[MIT](LICENSE)
