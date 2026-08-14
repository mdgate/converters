# @mdgate/ai

Optional vision helper for mdgate converters. No default model — pass `baseURL`, `apiKey`, and `model`. The prompt is built in.

```ts
import { create } from '@mdgate/core';
import { ai } from '@mdgate/ai';
import { pdf } from '@mdgate/pdf';

const vision = ai({
  baseURL: 'https://api.example.com/v1',
  apiKey: process.env.MY_KEY!,
  model: 'my-vision-model',
});

const convert = create([pdf()], { ai: vision });
const markdown = await vision.readImage({ bytes, mime: 'image/jpeg' });
```

`baseURL` is the OpenAI-compatible API root (the same value the OpenAI SDK uses). Requests go to `{baseURL}/chat/completions`.
