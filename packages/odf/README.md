# @mdgate/odf

Convert OpenDocument text, spreadsheets, and presentations to Markdown. Outputs GitHub-Flavored Markdown. Works in Node, Edge, and
browsers. No native addons.

Handles: `.odt`, `.ods`, `.odp`

## Usage

```ts
import { toMarkdown } from '@mdgate/odf';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { odf } from '@mdgate/odf';

const convert = create([odf()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
