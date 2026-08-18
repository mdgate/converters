# @mdgate/video

Convert MP4, MOV, WebM, Matroska, and AVI video to Markdown. Outputs GitHub-Flavored Markdown. Works
in Node, Edge, and browsers. No native addons, no external dependencies.

Needs an `(input) => markdown` function — `@mdgate/ai` or your own. The whole file is handed to that
function. `all()` does not register `video()`.

```ts
import { create } from '@mdgate/core';
import { video } from '@mdgate/video';
import { ai } from '@mdgate/ai';

const convert = create([
  video(ai({ baseURL, apiKey, model }).convertVideo),
]);
```
