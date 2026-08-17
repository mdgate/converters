# @mdgate/core

Converter registry for mdgate: `create()`, the `Converter` contract, and `ConvertError`.

```ts
import { create } from '@mdgate/core';
import { pdf } from '@mdgate/pdf';

const convert = create([pdf()]);
const markdown = await convert(bytes);
```

Pass `image` when a converter should hand off images it cannot convert:

```ts
import { ai } from '@mdgate/ai';

const convert = create([pdf()], {
  image: ai({ baseURL, apiKey, model }),
});
```

`image` is just `(input) => markdown`. Apple OCR, Tesseract, or any other function with that shape works the same way.
