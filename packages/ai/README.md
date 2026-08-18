# @mdgate/ai

One `image` implementation for mdgate: an OpenAI-compatible vision model. No default endpoint — pass `baseURL`, `apiKey`, and `model`. The prompt is built in.

```ts
import { create } from '@mdgate/core';
import { image } from '@mdgate/image';
import { video } from '@mdgate/video';
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
  video(vision.convertVideo),
]);

// Same chat/completions endpoint; audio and video are sent as data URLs.
await vision.convertAudio({ bytes, mime: 'audio/mpeg' });
await vision.convertVideo({ bytes, mime: 'video/mp4' });
```

`baseURL` is the OpenAI-compatible API root (the same value the OpenAI SDK uses). Requests go to `{baseURL}/chat/completions`. Raster images include JPEG, PNG, WebP, GIF, TIFF, HEIC, and BMP. SVG is converted locally by `@mdgate/image`. Video includes MP4, MOV, WebM, Matroska, and AVI.
