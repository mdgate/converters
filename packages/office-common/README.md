# @mdgate/office-common

**Internal Office-format semantics shared by mdgate converters.**

This package is a shared library used by Word, PowerPoint, Excel, and related converters. Install a converter package (for example [`@mdgate/docx`](https://github.com/mdgate/converters/tree/main/packages/docx)) or [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) instead of depending on this directly.

---

## What it provides

* Word field codes
* list numbering
* style deltas
* border-grid tables
* DrawingML and OfficeArt graphics

These helpers keep OOXML and OLE office converters on one document model. Applications should not need them.

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

[`@mdgate/office-common`](https://github.com/mdgate/converters/tree/main/packages/office-common) is part of the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
