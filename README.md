# mdgate converters

Local document-to-markdown converters. Pass file bytes; get GitHub-Flavored Markdown.

Works in Node, Edge, and browsers. No native addons.

## Install

Everything:

```bash
npm i @mdgate/converters
```

Or pick families:

```bash
npm i @mdgate/core @mdgate/pdf
npm i @mdgate/core @mdgate/office
```

## Usage

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/converters';

const bytes = new Uint8Array(await readFile('notes.docx'));
const markdown = await toMarkdown(bytes, { path: 'notes.docx' });
```

`hint.path` is only a sniff hint (needed for signature-less formats like CSV). It is never read from disk.

Pick converters yourself:

```ts
import { create, image } from '@mdgate/core';
import { pdf } from '@mdgate/pdf';

const convert = create([pdf()]);
const markdown = await convert(bytes);
```

Hand off images the local converter cannot turn into markdown:

```ts
import { ai } from '@mdgate/ai';

const convert = create([
  pdf(),
  image(
    ai({
      baseURL: 'https://api.example.com/v1',
      apiKey: process.env.MY_KEY!,
      model: 'my-vision-model',
    }),
  ),
]);
```

## Packages

| Package | Role |
|---|---|
| `@mdgate/converters` | Bundle: `toMarkdown`, `all()`, re-exports |
| `@mdgate/core` | `create()`, `Converter`, `ConvertError` |
| `@mdgate/office` | doc/docx/ppt/pptx/xls/xlsx/odf/rtf/epub/csv |
| `@mdgate/pdf` | PDF |
| `@mdgate/ai` | Optional `image(ai({ baseURL, apiKey, model }))` |
