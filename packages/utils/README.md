# @mdgate/utils

**Internal text, byte, inflate, and encoding helpers for mdgate converters.**

This package is a shared library used across format converters. Install a converter package or [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) instead of depending on this directly.

---

## What it provides

* inflate / gzip
* legacy encodings and Unicode helpers
* byte and text utilities
* filename and URI helpers

Format packages use these primitives. Applications should not need them.

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

[`@mdgate/utils`](https://github.com/mdgate/converters/tree/main/packages/utils) is part of the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
