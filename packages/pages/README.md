# @mdgate/pages

Convert Apple Pages documents to Markdown. Outputs GitHub-Flavored Markdown. Works in Node, Edge, and
browsers. No native addons.

Handles: `.pages`

## Usage

```ts
import { toMarkdown } from '@mdgate/pages';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { pages } from '@mdgate/pages';

const convert = create([pages()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
