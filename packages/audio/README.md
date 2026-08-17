# @mdgate/audio

Convert MP3, WAV, M4A, AAC, Ogg, FLAC, and WebM audio to Markdown. Outputs GitHub-Flavored
Markdown. Works in Node, Edge, and browsers. No native addons.

Needs an `(input) => markdown` transcription function — `@mdgate/ai` or your own. `all()` does not
register `audio()`.

```ts
import { create } from '@mdgate/core';
import { audio } from '@mdgate/audio';
import { ai } from '@mdgate/ai';

const convert = create([
  audio(ai({ baseURL, apiKey, model }).convertAudio),
]);
```
