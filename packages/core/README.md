# @mdgate/core

Converter registry for mdgate: `create()`, the `Converter` contract, and `ConvertError`.

```ts
import { create } from '@mdgate/core';
import { pdf } from '@mdgate/pdf';

const convert = create([pdf()]);
const markdown = await convert(bytes);
```

Register `image()` when a converter should hand off pictures it cannot convert:

```ts
import { create, image } from '@mdgate/core';
import { ai } from '@mdgate/ai';

const convert = create([pdf(), image(ai({ baseURL, apiKey, model }))]);
```

The function you pass to `image()` is `(input) => markdown`. Apple OCR, Tesseract, or any other function with that shape works the same way.
