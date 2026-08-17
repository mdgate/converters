# @mdgate/rtf

Convert RTF documents to Markdown. Outputs GitHub-Flavored Markdown. Works in Node, Edge, and
browsers. No native addons.

Handles: `.rtf` (also RTF content wearing a `.doc` extension)

## Usage

```ts
import { toMarkdown } from '@mdgate/rtf';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { rtf } from '@mdgate/rtf';

const convert = create([rtf()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
