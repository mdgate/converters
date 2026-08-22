# @mdgate/core

**The mdgate converter contract.**

[`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core) is `create()`, the `Converter` interface, and `ConvertError`. Format packages implement this contract. Applications compose readers with it.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/core
```

---

## Why [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core)

Each format package can be used alone. `create()` is how you build a reader from more than one of them.

Converters compete by sniff score. Content signatures outrank extension hints. Nested converters (ZIP, PDF images, OneNote packages) call back into the same registry.

* **Pure TypeScript**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**

---

## Compose a reader

```ts
import { create } from '@mdgate/core';
import { pdf } from '@mdgate/pdf';
import { docx } from '@mdgate/docx';
import { xlsx } from '@mdgate/xlsx';

const read = create([
  pdf(),
  docx(),
  xlsx(),
]);

const markdown = await read(bytes);
```

The optional second argument is a format hint:

```ts
const markdown = await read(bytes, {
  path: 'records.csv',
});
```

`path` is never used to read a file from disk.

---

## Write a converter

A converter identifies its input and returns Markdown:

```ts
import type { Converter } from '@mdgate/core';
import { documentToMarkdown } from '@mdgate/document';

export function myFormat(): Converter {
  return {
    id: 'my-format',

    sniff(bytes) {
      return looksLikeMyFormat(bytes) ? 2 : 0;
    },

    convert(bytes) {
      return {
        markdown: documentToMarkdown(
          parseMyFormat(bytes),
        ),
      };
    },
  };
}
```

Content signatures should return 2. Extension hints should return 1.

---

## Errors

A conversion throws when meaningful Markdown cannot be produced.

```ts
import { ConvertError, create } from '@mdgate/core';

try {
  const markdown = await read(bytes);
} catch (error) {
  if (error instanceof ConvertError) {
    console.error(error.code);
  }
}
```

| Code            | Meaning                                     |
| --------------- | ------------------------------------------- |
| `unsupported`   | The format is unknown or unsupported        |
| `malformed`     | No meaningful content could be extracted    |
| `encrypted`     | The file is encrypted or password-protected |
| `missingPart`   | Required document data is missing           |
| `io`            | The input could not be read                 |
| `resourceLimit` | Reserved for resource-limit failures        |

---

## Need a complete reader?

```bash
npm install @mdgate/converters
```

```ts
import { toMarkdown } from '@mdgate/converters';

const markdown = await toMarkdown(bytes, {
  path: filename,
});
```

[`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core) is part of the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
