# @mdgate/odf

Convert OpenDocument text, spreadsheets, presentations, and drawings to Markdown. Outputs GitHub-Flavored Markdown. Works in Node, Edge, and
browsers. No native addons.

Handles: `.odt`, `.ods`, `.odp`, `.odg`, templates (`.ott`, `.ots`, `.otp`, `.otg`), and flat XML (`.fodt`, `.fods`, `.fodp`, `.fodg`)

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
