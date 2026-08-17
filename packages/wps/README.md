# @mdgate/wps

Convert Kingsoft WPS Writer, Spreadsheets, and Presentation files to Markdown.
Outputs GitHub-Flavored Markdown. Works in Node, Edge, and browsers. No native
addons.

Handles: `.wps`, `.wpt`, `.et`, `.ett`, `.dps`, `.dpt`

OOXML/OLE Office-compatible files are delegated to the matching official
converter. Proprietary Kingsoft packages are best-effort text extraction.

## Usage

```ts
import { toMarkdown } from '@mdgate/wps';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { wps } from '@mdgate/wps';

const convert = create([wps()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
