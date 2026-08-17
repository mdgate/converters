# @mdgate/onenote

Convert Microsoft OneNote section and notebook files to Markdown. Outputs
GitHub-Flavored Markdown. Works in Node, Edge, and browsers. No native addons.

Handles: `.one`, `.onetoc2`, `.onepkg`

v1 is best-effort text extraction (page titles and body lines), not a full
OneNote renderer.

## Usage

```ts
import { toMarkdown } from '@mdgate/onenote';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { onenote } from '@mdgate/onenote';

const convert = create([onenote()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
