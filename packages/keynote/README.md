# @mdgate/keynote

Convert Apple Keynote presentations to Markdown. Outputs GitHub-Flavored Markdown. Works in Node, Edge, and
browsers. No native addons.

Handles: `.key`

## Usage

```ts
import { toMarkdown } from '@mdgate/keynote';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { keynote } from '@mdgate/keynote';

const convert = create([keynote()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
