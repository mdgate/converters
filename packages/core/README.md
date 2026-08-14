# @mdgate/core

Converter registry for mdgate: `create()`, the `Converter` contract, and `ConvertError`.

```ts
import { create } from '@mdgate/core';
import { pdf } from '@mdgate/pdf';

const convert = create([pdf()]);
const markdown = await convert(bytes);
```
