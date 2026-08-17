# @mdgate/mobi

Convert PalmDOC, MOBI, and KF8/AZW3 ebooks to Markdown. Outputs GitHub-Flavored Markdown. Works in
Node, Edge, and browsers. No native addons.

Handles: `.mobi`, `.azw`, `.azw3`, `.prc`

## Usage

```ts
import { toMarkdown } from '@mdgate/mobi';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { mobi } from '@mdgate/mobi';

const convert = create([mobi()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.

## Limitations (v1)

- DRM-encrypted books are rejected (`ConvertError.encrypted`).
- Text records are extracted: uncompressed PalmDOC, PalmDOC LZ77, and HUFF/CDIC.
- KF8/AZW3 XHTML is converted when it can be isolated from the text stream. Skeleton + fragment
  reconstruction via INDX is not implemented, so some AZW3 books lose structure.
- Images, fonts, audio, and NCX/toc indexes are not extracted.
- Topaz (`TPZ`) Kindle files are not supported.
