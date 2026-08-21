# @mdgate/html

Convert HTML, XHTML, and MHTML files to Markdown. Outputs GitHub-Flavored Markdown. Works in Node,
Edge, and browsers. No native addons.

Handles: `.html`, `.htm`, `.html4`, `.html5`, `.xhtml`, `.mhtml`, `.mht`

## Usage

```ts
import { toMarkdown } from '@mdgate/html';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { html } from '@mdgate/html';

const convert = create([html()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
