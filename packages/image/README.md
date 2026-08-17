# @mdgate/image

Converter for JPEG, PNG, and WebP. Pass any `(input) => markdown` function — `@mdgate/ai`, Apple OCR, or your own.

```ts
import { create } from '@mdgate/core';
import { image } from '@mdgate/image';
import { pdf } from '@mdgate/pdf';
import { ai } from '@mdgate/ai';

const convert = create([
  pdf(),
  image(ai({ baseURL, apiKey, model }).convertImage),
]);
```
