# @mdgate/csv

Convert CSV files to Markdown tables. Outputs GitHub-Flavored Markdown. Works in Node, Edge, and
browsers. No native addons.

Handles: `.csv` (comma, semicolon, or tab separated; UTF-8/UTF-16)

## Usage

```ts
import { toMarkdown } from '@mdgate/csv';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { csv } from '@mdgate/csv';

const convert = create([csv()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
