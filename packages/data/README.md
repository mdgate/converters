# @mdgate/data

Convert JSON, JSONL, XML, and YAML files to Markdown. Outputs GitHub-Flavored Markdown. Works in
Node, Edge, and browsers. No native addons.

Handles: `.json`, `.jsonl`, `.xml`, `.yaml`, `.yml`

XML is never claimed by content signature — flat ODF and many office parts start with `<?xml`.

## Usage

```ts
import { toMarkdown } from '@mdgate/data';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { data } from '@mdgate/data';

const convert = create([data()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
