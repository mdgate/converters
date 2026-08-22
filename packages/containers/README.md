# @mdgate/containers

**Internal ZIP/OPC, OLE, and XML helpers for mdgate converters.**

This package is a shared library used by format converters. Install a converter package (for example [`@mdgate/docx`](https://github.com/mdgate/converters/tree/main/packages/docx)) or [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) instead of depending on this directly.

---

## What it provides

* ZIP / OPC package reading
* OLE compound files (CFB)
* a namespace-aware XML parser
* container-level format detection (which Office, ODF, EPUB, or iWork package a ZIP or OLE file is)

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

[`@mdgate/containers`](https://github.com/mdgate/converters/tree/main/packages/containers) is part of the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
