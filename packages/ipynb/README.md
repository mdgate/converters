# @mdgate/ipynb

Convert Jupyter notebooks to Markdown. Outputs GitHub-Flavored Markdown. Works in Node, Edge, and
browsers. No native addons.

Handles: `.ipynb` (nbformat JSON)

## Usage

```ts
import { toMarkdown } from '@mdgate/ipynb';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { ipynb } from '@mdgate/ipynb';

const convert = create([ipynb()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
