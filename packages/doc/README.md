# @mdgate/doc

Convert legacy binary Word documents to Markdown. Outputs GitHub-Flavored Markdown. Works in Node, Edge, and
browsers. No native addons.

Handles: `.doc` (binary Word)

## Usage

```ts
import { toMarkdown } from '@mdgate/doc';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { doc } from '@mdgate/doc';

const convert = create([doc()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
