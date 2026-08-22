# @mdgate/image

Converters for JPEG, PNG, WebP, GIF, TIFF, HEIC, BMP, SVG, and gzip SVG (`.svgz`).

Raster formats need an `(input) => markdown` function — `@mdgate/ai`, Apple OCR, or your own. SVG is converted locally (`svg()`, or `image()` without calling that function). `all()` registers `svg()`, not `image()`.

```ts
import { create } from '@mdgate/core';
import { image, svg } from '@mdgate/image';
import { pdf } from '@mdgate/pdf';
import { ai } from '@mdgate/ai';

const convert = create([
  pdf(),
  svg(),
  image(ai({ baseURL, apiKey, model }).convertImage),
]);
```
