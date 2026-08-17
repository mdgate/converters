# @mdgate/ai

One `image` implementation for mdgate: an OpenAI-compatible vision model. No default endpoint — pass `baseURL`, `apiKey`, and `model`. The prompt is built in.

```ts
import { create } from '@mdgate/core';
import { image } from '@mdgate/image';
import { ai } from '@mdgate/ai';
import { pdf } from '@mdgate/pdf';

const vision = ai({
  baseURL: 'https://api.example.com/v1',
  apiKey: process.env.MY_KEY!,
  model: 'my-vision-model',
});

const convert = create([
  pdf(),
  image(vision.convertImage),
]);

// Same chat/completions endpoint; audio is sent as a data URL.
await vision.convertAudio({ bytes, mime: 'audio/mpeg' });
```

`baseURL` is the OpenAI-compatible API root (the same value the OpenAI SDK uses). Requests go to `{baseURL}/chat/completions`. Raster images include JPEG, PNG, WebP, GIF, TIFF, HEIC, and BMP. SVG is converted locally by `@mdgate/image`.
