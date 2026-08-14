# @mdgate/office

mdgate converter for Office and related formats: doc, docx, ppt, pptx, xls, xlsx, odt, odp, ods, rtf, epub, csv.

```ts
import { create } from '@mdgate/core';
import { office } from '@mdgate/office';

const convert = create([office()]);
const markdown = await convert(bytes, { path: 'notes.docx' });
```
