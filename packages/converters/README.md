# @mdgate/converters

Official mdgate converter bundle. Includes office and PDF converters.

```ts
import { toMarkdown } from '@mdgate/converters';

const markdown = await toMarkdown(bytes, { path: 'notes.docx' });
```

Or compose converters yourself:

```ts
import { all, create } from '@mdgate/converters';

const convert = create(all());
```
