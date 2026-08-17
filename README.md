# mdgate converters

Local document-to-markdown converters. Pass file bytes; get GitHub-Flavored Markdown.

Works in Node, Edge, and browsers. No native addons.

The in-browser demo is at [demo.mdgate.dev](https://demo.mdgate.dev). From this repo: `bun run dev:demo`.

## Install

Everything:

```bash
npm i @mdgate/converters
```

Or exactly the formats you need — one package per format, nothing else comes along:

```bash
npm i @mdgate/docx
npm i @mdgate/pdf
npm i @mdgate/pages
```

## Usage

Batteries included:

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/converters';

const bytes = new Uint8Array(await readFile('notes.docx'));
const markdown = await toMarkdown(bytes, { path: 'notes.docx' });
```

`hint.path` is only a sniff hint (needed for signature-less formats like CSV). It is never read from disk.

One format — same function, different import:

```ts
import { toMarkdown } from '@mdgate/docx';

const markdown = await toMarkdown(bytes);
```

Compose your own set:

```ts
import { create } from '@mdgate/core';
import { docx } from '@mdgate/docx';
import { pdf } from '@mdgate/pdf';

const convert = create([docx(), pdf()]);
const markdown = await convert(bytes);
```

Hand off images the local converters cannot turn into markdown:

```ts
import { image } from '@mdgate/image';
import { ai } from '@mdgate/ai';

const convert = create([
  pdf(),
  image(
    ai({
      baseURL: 'https://api.example.com/v1',
      apiKey: process.env.MY_KEY!,
      model: 'my-vision-model',
    }).convertImage,
  ),
]);
```

## Packages

Converters — each exports a factory (for `create`) and its own `toMarkdown`:

| Package | Handles |
|---|---|
| `@mdgate/converters` | Bundle: every format below, `toMarkdown`, `all()` |
| `@mdgate/docx` | docx, docm |
| `@mdgate/doc` | doc (binary Word) |
| `@mdgate/rtf` | rtf |
| `@mdgate/pptx` | pptx, pptm, ppsx, ppsm |
| `@mdgate/ppt` | ppt, pps, pot (binary PowerPoint) |
| `@mdgate/xlsx` | xlsx, xlsm, xlsb, xls |
| `@mdgate/csv` | csv |
| `@mdgate/text` | txt, md, and source files |
| `@mdgate/data` | json, jsonl, xml, yaml |
| `@mdgate/subtitle` | srt, vtt, webvtt |
| `@mdgate/html` | html, htm, xhtml, mhtml, mht |
| `@mdgate/email` | eml, msg, mbox, emlx |
| `@mdgate/ipynb` | ipynb (Jupyter) |
| `@mdgate/odf` | odt, ods, odp |
| `@mdgate/pages` | pages |
| `@mdgate/numbers` | numbers |
| `@mdgate/keynote` | key |
| `@mdgate/epub` | epub |
| `@mdgate/pdf` | pdf |
| `@mdgate/fb2` | fb2, fb2.zip |
| `@mdgate/mobi` | mobi, azw, azw3, prc |
| `@mdgate/latex` | tex, latex, ltx |
| `@mdgate/visio` | vsd, vsdx, vss, vst, vssx, vstx |
| `@mdgate/onenote` | one, onetoc2, onepkg |
| `@mdgate/hwp` | hwp, hwpx, hwt, hwtx |
| `@mdgate/wps` | wps, wpt, et, ett, dps, dpt |
| `@mdgate/zip` | zip, zipx, jar |
| `@mdgate/image` | jpeg/png/webp/gif/tiff/heic/bmp via a vision callback; svg locally (`svg()` is in `all()`) |
| `@mdgate/audio` | mp3/wav/m4a/aac/ogg/flac/webm via a transcription callback |
| `@mdgate/ai` | Optional `image(ai({ baseURL, apiKey, model }).convertImage)` |

Contract and shared layers:

| Package | Role |
|---|---|
| `@mdgate/core` | `create()`, the `Converter` interface, `ConvertError` |
| `@mdgate/document` | Shared document model + Markdown renderer |
| `@mdgate/containers` | Internal: ZIP/OPC, OLE (CFB), XML parsing |
| `@mdgate/office-common` | Internal: shared office-format semantics |
| `@mdgate/iwork-common` | Internal: Apple iWork IWA / Snappy / protobuf helpers |
| `@mdgate/utils` | Internal: text, byte, inflate, encoding helpers |

## Write your own converter

A converter is two functions: `sniff` says whether the bytes are yours,
`convert` turns them into markdown. Parse into a `Document` from
`@mdgate/document` and render with `documentToMarkdown` so your output matches
every other converter:

```ts
import type { Converter } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';

export function myFormat(): Converter {
  return {
    id: 'my-format',
    sniff: (bytes) => (looksLikeMyFormat(bytes) ? 2 : 0),
    convert: (bytes) => ({ markdown: documentToMarkdown(parseMyFormat(bytes)) }),
  };
}
```

Converters registered with `create()` compete by sniff score; content
signatures (score 2) outrank extension hints (score 1).
