# @mdgate/image

Registers an image-to-markdown function with `create()`. The function can be `@mdgate/ai`, Apple OCR, or anything else that returns markdown.

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
