# @mdgate/text

Convert plain text, Markdown, and source files to Markdown. Outputs GitHub-Flavored Markdown. Works
in Node, Edge, and browsers. No native addons.

Handles: `.txt`, `.text`, `.md`, `.markdown`, `.mdx`, and common source extensions (`.js`, `.ts`,
`.py`, `.go`, `.rs`, and similar). Markdown is passed through; source is wrapped in a fenced code
block.

## Usage

```ts
import { toMarkdown } from '@mdgate/text';

const markdown = await toMarkdown(bytes, { path: 'notes.txt' });
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { text } from '@mdgate/text';

const convert = create([text()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
