# @mdgate/iwork-common

**Internal Apple iWork archive parsing for mdgate converters.**

This package is a shared library used by [`@mdgate/pages`](https://github.com/mdgate/converters/tree/main/packages/pages), [`@mdgate/numbers`](https://github.com/mdgate/converters/tree/main/packages/numbers), and [`@mdgate/keynote`](https://github.com/mdgate/converters/tree/main/packages/keynote). Install one of those packages or [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) instead of depending on this directly.

---

## What it provides

* ZIP / `Index.zip` opening
* Snappy IWA chunks
* protobuf wire decoding
* TSWP text storage
* TST tables
* older pre-IWA iWork documents

These helpers keep the three iWork converters on one archive implementation. Applications should not need them.

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

[`@mdgate/iwork-common`](https://github.com/mdgate/converters/tree/main/packages/iwork-common) is part of the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
