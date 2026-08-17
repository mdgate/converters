# @mdgate/pptx

Convert PowerPoint presentations to Markdown. Outputs GitHub-Flavored Markdown. Works in Node, Edge, and
browsers. No native addons.

Handles: `.pptx`, `.pptm`, `.ppsx`, `.ppsm`, `.potx`, `.potm`

## Usage

```ts
import { toMarkdown } from '@mdgate/pptx';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { pptx } from '@mdgate/pptx';

const convert = create([pptx()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
