# @mdgate/fb2

Convert FictionBook (FB2) files to Markdown. Outputs GitHub-Flavored Markdown. Works in Node, Edge,
and browsers. No native addons.

Handles: `.fb2`, `.fb2.zip`

## Usage

```ts
import { toMarkdown } from '@mdgate/fb2';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { fb2 } from '@mdgate/fb2';

const convert = create([fb2()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
