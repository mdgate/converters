# @mdgate/pdf

mdgate PDF converter.

```ts
import { create } from '@mdgate/core';
import { pdf } from '@mdgate/pdf';

const convert = create([pdf()]);
const markdown = await convert(bytes);
```

Node loads `maps.bin` from disk. Browsers, Cloudflare Workers, and other Edge runtimes must pass the bytes first:

```ts
import { setPdfMaps, toMarkdown } from '@mdgate/pdf';
import maps from '@mdgate/pdf/maps.bin';

setPdfMaps(new Uint8Array(maps));
const markdown = await toMarkdown(bytes);
```

Wrangler needs a Data rule so `.bin` imports resolve:

```jsonc
{
  "rules": [{ "type": "Data", "globs": ["**/*.bin"] }]
}
```

In Vite, import with `?url` and `fetch` the file.
