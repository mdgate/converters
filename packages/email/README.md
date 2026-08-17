# @mdgate/email

Convert email messages to Markdown. Outputs GitHub-Flavored Markdown. Works in Node, Edge, and
browsers. No native addons.

Handles: `.eml`, `.msg`, `.mbox`, `.emlx`

## Usage

```ts
import { toMarkdown } from '@mdgate/email';

const markdown = await toMarkdown(bytes);
```

Compose with other converters:

```ts
import { create } from '@mdgate/core';
import { email } from '@mdgate/email';

const convert = create([email()]);
```

Part of [mdgate converters](https://github.com/mdgate/converters); install
`@mdgate/converters` for every format at once.
