# @mdgate/converters

Official mdgate converter bundle: every format converter in one install.

[Try the in-browser demo](https://demo.mdgate.dev). Full docs live in the
[repository README](https://github.com/mdgate/converters#readme).

```ts
import { toMarkdown } from '@mdgate/converters';

const markdown = await toMarkdown(bytes, { path: 'notes.docx' });
```

Or compose converters yourself:

```ts
import { all, create } from '@mdgate/converters';

const convert = create(all());
```

`all()` registers every converter that needs no configuration. `image()`,
`audio()`, and `video()` need callbacks, so they are exported but not included
in `all()`. PDF outside Node needs `setPdfMaps()` and, on Wrangler, a Data rule
for `**/*.bin`. See the [repository README](https://github.com/mdgate/converters#pdf-mapping-tables).

Only need one format? Install just that package instead — for example
`@mdgate/docx` — and call its identical `toMarkdown`.

| Package | Handles |
|---|---|
| `@mdgate/converters` | Bundle: every format below, `toMarkdown`, `all()` |
| `@mdgate/docx` | docx, docm |
| `@mdgate/doc` | doc (binary Word) |
| `@mdgate/rtf` | rtf |
| `@mdgate/pptx` | pptx, pptm, ppsx, ppsm |
| `@mdgate/ppt` | ppt, pps, pot (binary PowerPoint) |
| `@mdgate/xlsx` | xlsx, xlsm, xlsb, xls |
| `@mdgate/csv` | csv |
| `@mdgate/text` | txt, md, and source files |
| `@mdgate/data` | json, jsonl, xml, yaml |
| `@mdgate/subtitle` | srt, vtt, webvtt |
| `@mdgate/html` | html, htm, xhtml, mhtml, mht |
| `@mdgate/email` | eml, msg, mbox, emlx |
| `@mdgate/ipynb` | ipynb (Jupyter) |
| `@mdgate/odf` | odt, ods, odp |
| `@mdgate/pages` | pages |
| `@mdgate/numbers` | numbers |
| `@mdgate/keynote` | key |
| `@mdgate/epub` | epub |
| `@mdgate/pdf` | pdf |
| `@mdgate/fb2` | fb2, fb2.zip |
| `@mdgate/mobi` | mobi, azw, azw3, prc |
| `@mdgate/latex` | tex, latex, ltx |
| `@mdgate/visio` | vsd, vsdx, vss, vst, vssx, vstx |
| `@mdgate/onenote` | one, onetoc2, onepkg |
| `@mdgate/hwp` | hwp, hwpx, hwt, hwtx |
| `@mdgate/wps` | wps, wpt, et, ett, dps, dpt |
| `@mdgate/zip` | zip, zipx, jar |
| `@mdgate/image` | jpeg\*, png\*, webp\*, gif\*, tiff\*, heic\*, bmp\*, svg |
| `@mdgate/audio` | mp3\*, wav\*, m4a\*, aac\*, ogg\*, flac\*, weba\* |
| `@mdgate/video` | mp4\*, m4v\*, mov\*, webm\*, mkv\*, avi\* |

\* Needs a callback — vision for raster images (`image()`), transcription for audio (`audio()`), video understanding for `video()`. Not registered by `all()`. SVG converts locally.
