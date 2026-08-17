# @mdgate/converters

Official mdgate converter bundle: every format converter in one install
(docx, doc, rtf, pptx, ppt, xlsx, csv, odf, epub, pdf).

```ts
import { toMarkdown } from '@mdgate/converters';

const markdown = await toMarkdown(bytes, { path: 'notes.docx' });
```

Or compose converters yourself:

```ts
import { all, create } from '@mdgate/converters';

const convert = create(all());
```

Only need one format? Install just that package instead — for example
`@mdgate/docx` — and call its identical `toMarkdown`.
