# @mdgate/zip

Convert generic ZIP archives by converting each member. Outputs GitHub-Flavored Markdown. Works in
Node, Edge, and browsers. No native addons.

Handles: `.zip`, `.zipx`, `.jar` (not Office/ODF/EPUB/iWork packages — those win at sniff 2)

## Usage

```ts
import { toMarkdown } from '@mdgate/zip';

const markdown = await toMarkdown(bytes);
```

Compose with other converters so members are converted by format:

```ts
import { create } from '@mdgate/core';
import { csv } from '@mdgate/csv';
import { zip } from '@mdgate/zip';

const convert = create([zip(), csv()]);
```

Without a nested `convert`, member names are listed as a bullet list.

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
