# @mdgate/ai

**Optional multimodal callbacks for mdgate image, audio, and video conversion.**

[`@mdgate/ai`](https://github.com/mdgate/converters/tree/main/packages/ai) talks to an OpenAI-compatible `chat/completions` endpoint. There is no default provider. You pass `baseURL`, `apiKey`, and `model`.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/ai
```

---

## Why [`@mdgate/ai`](https://github.com/mdgate/converters/tree/main/packages/ai)

Raster images, audio, and video are not deterministic document formats. mdgate does not pick an OCR or speech vendor.

This package is a thin adapter so the model you already use can plug into [`@mdgate/image`](https://github.com/mdgate/converters/tree/main/packages/image), [`@mdgate/audio`](https://github.com/mdgate/converters/tree/main/packages/audio), and [`@mdgate/video`](https://github.com/mdgate/converters/tree/main/packages/video).

* **No default endpoint**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **The prompt is built in**

SVG still converts locally in [`@mdgate/image`](https://github.com/mdgate/converters/tree/main/packages/image). You do not need this package for SVG.

---

## Usage

```ts
import { create } from '@mdgate/core';
import { ai } from '@mdgate/ai';
import { image } from '@mdgate/image';
import { audio } from '@mdgate/audio';
import { video } from '@mdgate/video';
import { pdf } from '@mdgate/pdf';

const media = ai({
  baseURL: 'https://api.example.com/v1',
  apiKey: process.env.API_KEY!,
  model: 'your-model',
});

const read = create([
  pdf(),
  image(media.convertImage),
  audio(media.convertAudio),
  video(media.convertVideo),
]);
```

`baseURL` is the OpenAI-compatible API root (the same value the OpenAI SDK uses). Requests go to `{baseURL}/chat/completions`.

Audio and video are sent as data URLs.

These callbacks are not registered by `all()`. Compose them yourself.

---

## What it covers

Raster images: JPEG, PNG, WebP, GIF, TIFF, HEIC, BMP.

Audio: MP3, WAV, M4A, AAC, Ogg, FLAC, WebM audio.

Video: MP4, MOV, WebM, Matroska, AVI.

You can also call the helpers directly:

```ts
await media.convertImage({ bytes, mime: 'image/png' });
await media.convertAudio({ bytes, mime: 'audio/mpeg' });
await media.convertVideo({ bytes, mime: 'video/mp4' });
```

---

## Need a complete reader?

```bash
npm install @mdgate/converters
```

Then add `image()`, `audio()`, and `video()` on top of `all()`.

[`@mdgate/ai`](https://github.com/mdgate/converters/tree/main/packages/ai) is part of the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
