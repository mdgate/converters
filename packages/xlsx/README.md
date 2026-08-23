# @mdgate/xlsx

**Convert Excel workbooks to Markdown in TypeScript.**

[`@mdgate/xlsx`](https://github.com/mdgate/converters/tree/main/packages/xlsx) reads `.xlsx`, `.xlsm`, `.xlsb`, `.xls`, `.xltx`, `.xltm`, and `.xlt` files directly in JavaScript and converts sheets into GitHub-Flavored Markdown tables, without Python, native addons, WASM, or Excel.

Works in **Node.js, Cloudflare Workers, Edge runtimes, and browsers**.

```bash
npm install @mdgate/xlsx
```

```ts
import { toMarkdown } from '@mdgate/xlsx';

const markdown = await toMarkdown(bytes);
```

`bytes` is a `Uint8Array`, so the workbook can come from a file upload, object storage, an HTTP request, a browser file picker, or anywhere else your application gets bytes.

---

## Why [`@mdgate/xlsx`](https://github.com/mdgate/converters/tree/main/packages/xlsx)

Spreadsheets are how a lot of operational truth is stored: inventories, reports, exports from other systems.

[`@mdgate/xlsx`](https://github.com/mdgate/converters/tree/main/packages/xlsx) is a workbook reader written for the same runtime as your application:

* **Pure TypeScript**
* **Excel → Markdown locally**
* **No Python runtime**
* **No native addons**
* **No WASM runtime**
* **Zero third-party runtime dependencies**
* **Works with raw `Uint8Array` input**
* **Detects Excel packages and binary workbooks from their contents, not only the filename**

Use it when an agent or search index needs sheet contents as text, not a spreadsheet UI.

---

## What it extracts

[`@mdgate/xlsx`](https://github.com/mdgate/converters/tree/main/packages/xlsx) parses OOXML, XLSB, and binary `.xls` workbooks into a shared document model.

The converter handles Excel-specific concerns including:

* one Markdown section per sheet
* GitHub-Flavored Markdown tables
* merged cells
* header-row detection
* number formats (dates, percents, currency-style text)
* shared strings and typed cell values
* encrypted workbook detection

The output is Markdown that can be searched, indexed, chunked, cached, or passed directly to an AI agent.

CSV is a different format. Use [`@mdgate/csv`](https://github.com/mdgate/converters/tree/main/packages/csv) for `.csv` / `.tsv`.

---

## Node.js

```ts
import { readFile } from 'node:fs/promises';
import { toMarkdown } from '@mdgate/xlsx';

const bytes = new Uint8Array(await readFile('sheet.xlsx'));
const markdown = await toMarkdown(bytes);

console.log(markdown);
```

---

## Browser

```ts
import { toMarkdown } from '@mdgate/xlsx';

const file = input.files![0];
const bytes = new Uint8Array(await file.arrayBuffer());

const markdown = await toMarkdown(bytes);
```

---

## Cloudflare Workers and Edge runtimes

```ts
import { toMarkdown } from '@mdgate/xlsx';

export default {
  async fetch(request: Request) {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const markdown = await toMarkdown(bytes);

    return new Response(markdown, {
      headers: {
        'content-type': 'text/markdown; charset=utf-8',
      },
    });
  },
};
```

```text
upload XLSX
↓
Cloudflare Worker
↓
@mdgate/xlsx
↓
Markdown
↓
agent / search / index / storage
```

---

## Format detection

You do not need to trust the file extension.

[`@mdgate/xlsx`](https://github.com/mdgate/converters/tree/main/packages/xlsx) recognizes Excel OOXML packages and binary `.xls` OLE streams from their contents.

```ts
const markdown = await toMarkdown(bytes);
```

A path can still be supplied as a format hint when [`@mdgate/xlsx`](https://github.com/mdgate/converters/tree/main/packages/xlsx) is used through [`@mdgate/converters`](https://github.com/mdgate/converters/tree/main/packages/converters) or a reader composed with [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core), but the path is never used to read a file from disk.

---

## Encrypted workbooks

Encrypted or password-protected workbooks are reported as encrypted rather than returning misleading partial output.

---

## Compose it with other file readers

[`@mdgate/xlsx`](https://github.com/mdgate/converters/tree/main/packages/xlsx) implements the converter interface from [`@mdgate/core`](https://github.com/mdgate/converters/tree/main/packages/core).

```ts
import { create } from '@mdgate/core';
import { xlsx } from '@mdgate/xlsx';
import { csv } from '@mdgate/csv';
import { pdf } from '@mdgate/pdf';

const read = create([
  xlsx(),
  csv(),
  pdf(),
]);
```

The application still uses one reading interface while each format remains independently installable.

---

## Need more than Excel?

If your application needs to read many different file types, use the complete converter set:

```bash
npm install @mdgate/converters
```

```ts
import { toMarkdown } from '@mdgate/converters';

const markdown = await toMarkdown(bytes, {
  path: filename,
});
```

[`@mdgate/xlsx`](https://github.com/mdgate/converters/tree/main/packages/xlsx) is one of the single-format packages in the open-source [`mdgate/converters`](https://github.com/mdgate/converters) project.

For AI agents, the same converter architecture can be used to extend `read_file` from text files to real-world document formats.

---

## License

MIT
