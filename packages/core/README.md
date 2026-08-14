# @mdgate/core

Converter registry for mdgate: `create()`, the `Converter` contract, and `ConvertError`.

```ts
import { create } from '@mdgate/core';
import { pdf } from '@mdgate/pdf';

const convert = create([pdf()]);
const markdown = await convert(bytes);
```

Pass an `Ai` (from `@mdgate/ai`) when a converter should be able to read images:

```ts
import { ai } from '@mdgate/ai';

const convert = create([pdf()], {
  ai: ai({ baseURL, apiKey, model }),
});
```
