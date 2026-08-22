# @mdgate/audio

**Convert audio to Markdown in TypeScript.**

[`@mdgate/audio`](https://github.com/mdgate/converters/tree/main/packages/audio) recognizes MP3, WAV, M4A, AAC, Ogg, FLAC, and WebM audio, then hands the file to a transcription callback you provide.

It does not ship a speech model. `audio()` is not registered by `all()`.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/audio
```

---

## Why [`@mdgate/audio`](https://github.com/mdgate/converters/tree/main/packages/audio)

Audio is not a document format. Documents that software can parse are handled deterministically. Speech needs a model.

This package keeps that split:

```text
audio bytes → your transcription callback → Markdown
```

* **Pure TypeScript**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies in this package**
* **Detects common audio types from their contents, not only the filename**
* **Not included in `all()`**

---

## What it does

The converter sniffs the audio type, then calls your `(input) => markdown` function with `{ bytes, mime }`.

The whole file is passed through. mdgate does not decode or resample the audio.

Without a callback, conversion fails as unsupported.

---

## Usage

```ts
import { create } from '@mdgate/core';
import { audio } from '@mdgate/audio';
import { ai } from '@mdgate/ai';

const media = ai({
  baseURL: 'https://api.example.com/v1',
  apiKey: process.env.API_KEY!,
  model: 'your-model',
});

const read = create([
  audio(media.convertAudio),
]);

const markdown = await read(bytes, {
  path: 'meeting.mp3',
});
```

Or pass any transcription function:

```ts
import { create } from '@mdgate/core';
import { audio } from '@mdgate/audio';

const read = create([
  audio(async (input) => {
    // Send input.bytes to the speech model you already use.
    return '...';
  }),
]);
```

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { create } from '@mdgate/core';
import { audio } from '@mdgate/audio';

const read = create([
  audio(transcribe),
]);

const bytes = new Uint8Array(await readFile('meeting.mp3'));
const markdown = await read(bytes, { path: 'meeting.mp3' });
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { create } from '@mdgate/core';
import { audio } from '@mdgate/audio';

const read = create([
  audio(transcribe),
]);

export default {
  async fetch(request: Request) {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const markdown = await read(bytes);

    return new Response(markdown, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
      },
    });
  },
};
```

---

## Need more than audio?

If your application needs to read many different file types, use the complete converter set, then add `audio()` on top. `all()` does not register it.

```bash
npm install @mdgate/converters
```

[`@mdgate/audio`](https://github.com/mdgate/converters/tree/main/packages/audio) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
