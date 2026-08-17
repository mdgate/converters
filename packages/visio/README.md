# @mdgate/visio

Convert Microsoft Visio drawings to Markdown. Outputs GitHub-Flavored Markdown. Works in Node, Edge,
and browsers. No native addons.

Handles: `.vsd`, `.vsdx`, `.vss`, `.vst`, `.vssx`, `.vstx`

## Usage

```ts
import { toMarkdown } from '@mdgate/visio';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { visio } from '@mdgate/visio';

const convert = create([visio()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
