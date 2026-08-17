# @mdgate/numbers

Convert Apple Numbers spreadsheets to Markdown. Outputs GitHub-Flavored Markdown. Works in Node, Edge, and
browsers. No native addons.

Handles: `.numbers`

## Usage

```ts
import { toMarkdown } from '@mdgate/numbers';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { numbers } from '@mdgate/numbers';

const convert = create([numbers()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
