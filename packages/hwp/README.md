# @mdgate/hwp

Convert Hangul Word Processor files to Markdown. Outputs GitHub-Flavored Markdown. Works in Node,
Edge, and browsers. No native addons.

Handles: `.hwp`, `.hwpx`, `.hwt`, `.hwtx`

- **HWPX / HWTX** — ZIP + OWPML. Reads `Contents/section*.xml` (and `Contents/header.xml` for
  outline/heading styles) for paragraphs, line breaks, and tables.
- **HWP / HWT** — OLE compound files (HWP 5) or the classic `HWP Document File` signature (HWP 3).
  BodyText section streams are decompressed and scanned for `PARA_TEXT` records when the layout is
  recognizable. The binary record format is only partially specified publicly; when a stream is too
  opaque, readable UTF-16 strings (and the `PrvText` preview) are emitted as paragraphs. Tables,
  drawings, and other controls in binary HWP are not reconstructed.

Encrypted or distribution-locked documents fail with `ConvertError.encrypted`.

## Usage

```ts
import { toMarkdown } from '@mdgate/hwp';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { hwp } from '@mdgate/hwp';

const convert = create([hwp()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
