# @mdgate/docx

Convert Word documents to Markdown. Outputs GitHub-Flavored Markdown. Works in Node, Edge, and
browsers. No native addons.

Handles: `.docx`, `.docm`

## Usage

```ts
import { toMarkdown } from '@mdgate/docx';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { docx } from '@mdgate/docx';

const convert = create([docx()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
