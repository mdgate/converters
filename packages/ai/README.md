# @mdgate/ai

One `image` implementation for mdgate: an OpenAI-compatible vision model. No default endpoint — pass `baseURL`, `apiKey`, and `model`. The prompt is built in.

```ts
import { create, image } from '@mdgate/core';
import { ai } from '@mdgate/ai';
import { pdf } from '@mdgate/pdf';

const convert = create([
  pdf(),
  image(
    ai({
      baseURL: 'https://api.example.com/v1',
      apiKey: process.env.MY_KEY!,
      model: 'my-vision-model',
    }),
  ),
]);
```

`baseURL` is the OpenAI-compatible API root (the same value the OpenAI SDK uses). Requests go to `{baseURL}/chat/completions`.
