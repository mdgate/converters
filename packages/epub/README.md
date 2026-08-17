# @mdgate/epub

Convert EPUB books to Markdown. Outputs GitHub-Flavored Markdown. Works in Node, Edge, and
browsers. No native addons.

Handles: `.epub`

## Usage

```ts
import { toMarkdown } from '@mdgate/epub';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { epub } from '@mdgate/epub';

const convert = create([epub()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
