# @mdgate/subtitle

Convert subtitle and caption files to Markdown. Outputs GitHub-Flavored Markdown. Works in Node,
Edge, and browsers. No native addons.

Handles: `.srt`, `.vtt`, `.webvtt`, `.ass`, `.ssa`, `.lrc`, `.sub` (MicroDVD), `.sbv`, `.ttml`,
`.jss`

## Usage

```ts
import { toMarkdown } from '@mdgate/subtitle';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { subtitle } from '@mdgate/subtitle';

const convert = create([subtitle()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
