# @mdgate/xlsx

Convert Excel workbooks to Markdown tables. Outputs GitHub-Flavored Markdown. Works in Node, Edge, and
browsers. No native addons.

Handles: `.xlsx`, `.xlsm`, `.xlsb`, `.xls`, `.xltx`, `.xltm`, `.xlt`

## Usage

```ts
import { toMarkdown } from '@mdgate/xlsx';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { xlsx } from '@mdgate/xlsx';

const convert = create([xlsx()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
