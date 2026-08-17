# @mdgate/ppt

Convert legacy binary PowerPoint presentations to Markdown. Outputs GitHub-Flavored Markdown. Works in Node, Edge, and
browsers. No native addons.

Handles: `.ppt`, `.pps`, `.pot` (binary PowerPoint)

## Usage

```ts
import { toMarkdown } from '@mdgate/ppt';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { ppt } from '@mdgate/ppt';

const convert = create([ppt()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
