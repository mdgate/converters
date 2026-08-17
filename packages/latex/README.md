# @mdgate/latex

Convert LaTeX source to Markdown. Outputs GitHub-Flavored Markdown. Works in Node, Edge, and
browsers. No native addons.

Handles: `.tex`, `.latex`, `.ltx`

## Usage

```ts
import { toMarkdown } from '@mdgate/latex';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { latex } from '@mdgate/latex';

const convert = create([latex()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
