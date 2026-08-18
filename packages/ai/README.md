# @mdgate/ai

OpenAI-compatible callbacks for mdgate image, audio, and video conversion. No default endpoint: pass `baseURL`, `apiKey`, and `model`. The prompt is built in.

```ts
import { create } from '@mdgate/core';
import { image } from '@mdgate/image';
import { audio } from '@mdgate/audio';
import { video } from '@mdgate/video';
import { ai } from '@mdgate/ai';
import { pdf } from '@mdgate/pdf';

const media = ai({
  baseURL: 'https://api.example.com/v1',
  apiKey: process.env.MY_KEY!,
  model: 'my-vision-model',
});

const convert = create([
  pdf(),
  image(media.convertImage),
  audio(media.convertAudio),
  video(media.convertVideo),
]);

// Same chat/completions endpoint; audio and video are sent as data URLs.
await media.convertAudio({ bytes, mime: 'audio/mpeg' });
await media.convertVideo({ bytes, mime: 'video/mp4' });
```

`baseURL` is the OpenAI-compatible API root (the same value the OpenAI SDK uses). Requests go to `{baseURL}/chat/completions`. Raster images include JPEG, PNG, WebP, GIF, TIFF, HEIC, and BMP. SVG is converted locally by `@mdgate/image`. Audio includes MP3, WAV, M4A, AAC, Ogg, FLAC, and WebM audio. Video includes MP4, MOV, WebM, Matroska, and AVI.
