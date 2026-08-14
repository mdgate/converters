# mdgate vs anydoc speed (after leftover rounds + follow-up)

In-process conversion only (`anydoc::to_markdown` / `toMarkdown`). Warmup 2 iterations discarded, then N=10 timed iterations per file (N=3 if warmup mean > 200 ms). No file crossed that threshold. Values are **median ms** of the timed iterations.

- Corpus: 54 well-formed fixtures under `anydoc/tests/fixtures` (excludes `abuse/` and `*--errors*`).
- Rust: reuse of `/tmp/anydoc-bench` release calling `anydoc::to_markdown` in one process. JSON: `/tmp/mdgate-close-gap/rust-follow.json`.
- TypeScript: Node v22.21.1, compiled `dist/index.js` after leftover workflow + follow-up landings. JSON: `/tmp/mdgate-close-gap/ts-follow2.json`.
- Timed: 2026-08-13, macOS aarch64, sequential. Rust reused from the same-session remesure (binary unchanged); TS remesured after follow-up patches.
- Parity: `npx tsx test/parity.ts` **58/58**. `npm test` 82/82. Public API remains `export { toMarkdown }` only.

## Per fixture

| fixture | rust_ms | ts_ms | ts/rust |
| --- | ---: | ---: | ---: |
| **csv/** | | | |
| csv/handmade-quoted.csv | 0.0577 | 0.1476 | 2.56× |
| csv/handmade-semicolon.csv | 0.0577 | 0.0582 | 1.01× |
| csv/handmade-utf16.csv | 0.0579 | 0.0737 | 1.27× |
| csv/sheet.csv | 0.0733 | 0.2264 | 3.09× |
| **doc/** | | | |
| doc/handmade-blockstyle.doc | 0.0207 | 0.1466 | 7.08× |
| doc/handmade-cyrillic.doc | 0.0152 | 0.0857 | 5.65× |
| doc/handmade-shiftjis.doc | 0.0143 | 0.0720 | 5.05× |
| doc/text.doc | 0.0994 | 0.8155 | 8.20× |
| **docx/** | | | |
| docx/handmade-altpath.docx | 0.0498 | 0.2690 | 5.40× |
| docx/handmade-blockstyle.docx | 0.0544 | 0.2762 | 5.07× |
| docx/handmade-manyrefs.docx | 0.1222 | 0.6281 | 5.14× |
| docx/handmade-numbering.docx | 0.1129 | 0.4266 | 3.78× |
| docx/handmade-ole.docx | 0.0403 | 0.1097 | 2.72× |
| docx/handmade-outline.docx | 0.0417 | 0.1214 | 2.91× |
| docx/handmade-rich.docx | 0.0778 | 0.2388 | 3.07× |
| docx/handmade-strict.docx | 0.0382 | 0.1212 | 3.17× |
| docx/handmade-tables.docx | 0.0395 | 0.1226 | 3.10× |
| docx/text.docx | 0.3733 | 1.234 | 3.31× |
| **epub/** | | | |
| epub/book.epub | 0.1173 | 0.4717 | 4.02× |
| epub/handmade-css-links.epub | 0.0747 | 0.3094 | 4.14× |
| epub/handmade-features.epub | 0.0580 | 0.2870 | 4.95× |
| **malformed/** | | | |
| malformed/brokenpersist--recovers.ppt | 0.0524 | 0.3072 | 5.87× |
| malformed/corrupt-styles--skips.docx | 0.2914 | 0.9915 | 3.40× |
| malformed/mismatched--recovers.docx | 0.0281 | 0.0640 | 2.28× |
| malformed/missing-styles--skips.docx | 0.2874 | 0.7632 | 2.66× |
| malformed/unbalanced--recovers.rtf | 0.0377 | 0.3185 | 8.44× |
| malformed/unclosed--recovers.docx | 0.0278 | 0.0674 | 2.43× |
| **odp/** | | | |
| odp/pres.odp | 0.3870 | 0.6917 | 1.79× |
| **ods/** | | | |
| ods/handmade-durations.ods | 0.0264 | 0.0934 | 3.54× |
| ods/handmade-gaps.ods | 0.0552 | 0.2229 | 4.04× |
| ods/sheet.ods | 0.1661 | 0.3708 | 2.23× |
| **odt/** | | | |
| odt/handmade-blockstyle.odt | 0.0261 | 0.0648 | 2.48× |
| odt/handmade-defaults.odt | 0.0218 | 0.0558 | 2.56× |
| odt/handmade-lists.odt | 0.0224 | 0.0602 | 2.69× |
| odt/handmade-manifestcomment.odt | 0.0173 | 0.0368 | 2.13× |
| odt/text.odt | 0.2620 | 0.6478 | 2.47× |
| **pdf/** | | | |
| pdf/text.pdf | 1.561 | 2.094 | 1.34× |
| **ppt/** | | | |
| ppt/handmade-multimaster.ppt | 0.0171 | 0.0808 | 4.73× |
| ppt/handmade-sparsenotes.ppt | 0.0159 | 0.0731 | 4.60× |
| ppt/pres.ppt | 0.0532 | 0.2393 | 4.50× |
| **pptx/** | | | |
| pptx/handmade-altpath.pptx | 0.0423 | 0.1386 | 3.28× |
| pptx/handmade-inherit.pptx | 0.0699 | 0.2060 | 2.95× |
| pptx/handmade-links.pptx | 0.0504 | 0.1303 | 2.59× |
| pptx/handmade-order.pptx | 0.0510 | 0.1349 | 2.65× |
| pptx/handmade-strict.pptx | 0.0412 | 0.0852 | 2.07× |
| pptx/pres.pptx | 0.2979 | 0.5817 | 1.95× |
| **rtf/** | | | |
| rtf/handmade-bin.rtf | 0.0345 | 0.1489 | 4.31× |
| rtf/handmade-blockstyle.rtf | 0.0176 | 0.0509 | 2.89× |
| rtf/handmade-cocoa.rtf | 0.0321 | 0.1669 | 5.20× |
| rtf/handmade-merge.rtf | 0.0192 | 0.0893 | 4.65× |
| rtf/text.rtf | 0.3307 | 0.6329 | 1.91× |
| **xls/** | | | |
| xls/sheet.xls | 0.0358 | 0.2396 | 6.69× |
| **xlsx/** | | | |
| xlsx/handmade-merged.xlsx | 0.0377 | 0.1027 | 2.72× |
| xlsx/sheet.xlsx | 0.1065 | 0.3656 | 3.43× |

## By format folder (median of per-file medians)

| folder | n | rust_ms | ts_ms | ts/rust |
| --- | ---: | ---: | ---: | ---: |
| csv | 4 | 0.0578 | 0.1107 | 1.91× |
| doc | 4 | 0.0179 | 0.1162 | 6.48× |
| docx | 10 | 0.0521 | 0.2539 | 4.87× |
| epub | 3 | 0.0747 | 0.3094 | 4.14× |
| malformed | 6 | 0.0451 | 0.3128 | 6.94× |
| odp | 1 | 0.3870 | 0.6917 | 1.79× |
| ods | 3 | 0.0552 | 0.2229 | 4.04× |
| odt | 5 | 0.0224 | 0.0602 | 2.69× |
| pdf | 1 | 1.561 | 2.094 | 1.34× |
| ppt | 3 | 0.0171 | 0.0808 | 4.73× |
| pptx | 6 | 0.0507 | 0.1368 | 2.70× |
| rtf | 5 | 0.0321 | 0.1489 | 4.64× |
| xls | 1 | 0.0358 | 0.2396 | 6.69× |
| xlsx | 2 | 0.0721 | 0.2341 | 3.25× |

## Overall

| metric | rust_ms | ts_ms | ts/rust |
| --- | ---: | ---: | ---: |
| median of per-file medians | 0.0507 | 0.1579 | 3.11× |
| mean of per-file medians | 0.1133 | 0.3066 | 2.71× |
| sum of per-file medians | 6.119 | 16.559 | 2.71× |
| median of per-file ratios | — | — | 3.14× |
| mean of per-file ratios | — | — | 3.63× |
| files ok | 54/54 | 54/54 | |

Headline: **rust median = 0.0507 ms**, **ts median = 0.1579 ms**, **ts/rust = 3.11×**.

## Comparison to previous headlines

| | rust_ms | ts_ms | ts/rust | median of ratios |
| --- | ---: | ---: | ---: | ---: |
| pre-P0 | 0.0548 | 0.2214 | 4.04× | 3.81× |
| after P0+P1+P2 | 0.0484 | 0.1959 | 4.05× | 3.29× |
| leftover workflow r3 | 0.0515 | 0.1877 | 3.65× | 3.01× |
| this remesure (follow-up) | 0.0507 | 0.1579 | 3.11× | 3.14× |

**Where TypeScript is slowest**

| fixture | rust_ms | ts_ms | ts/rust |
| --- | ---: | ---: | ---: |
| malformed/unbalanced--recovers.rtf | 0.0377 | 0.3185 | 8.44× |
| doc/text.doc | 0.0994 | 0.8155 | 8.20× |
| doc/handmade-blockstyle.doc | 0.0207 | 0.1466 | 7.08× |
| xls/sheet.xls | 0.0358 | 0.2396 | 6.69× |
| malformed/brokenpersist--recovers.ppt | 0.0524 | 0.3072 | 5.87× |
| doc/handmade-cyrillic.doc | 0.0152 | 0.0857 | 5.65× |
| docx/handmade-altpath.docx | 0.0498 | 0.2690 | 5.40× |
| rtf/handmade-cocoa.rtf | 0.0321 | 0.1669 | 5.20× |

**Where TypeScript is closest**

| fixture | rust_ms | ts_ms | ts/rust |
| --- | ---: | ---: | ---: |
| csv/handmade-semicolon.csv | 0.0577 | 0.0582 | 1.01× |
| csv/handmade-utf16.csv | 0.0579 | 0.0737 | 1.27× |
| pdf/text.pdf | 1.561 | 2.094 | 1.34× |
| odp/pres.odp | 0.3870 | 0.6917 | 1.79× |
| rtf/text.rtf | 0.3307 | 0.6329 | 1.91× |
| pptx/pres.pptx | 0.2979 | 0.5817 | 1.95× |

## What landed

Workflow `close-to-markdown-gap` (5 rounds, then follow-up after its fail-closed verifiers dropped measured wins):

| axis | status |
| --- | --- |
| P0 `zip-inflate` / P1 `xml-dom` / P2 `odf-expand` | already in tree |
| `rtf-prelude-fusion` | workflow |
| `format-walk` / `epub-html` / `csv-parse` | workflow |
| `rtf-lexer-alloc` | follow-up (study measured 1.12→0.81 on `text.rtf`; verifier never ran Node) |
| `xls-biff` stream walk + numeric merge keys | follow-up |
| RTF ASCII `takePending` / `cleanTextFast` / unused-word skip / COW `CharState` | follow-up |
| Fold `scanCodepage` into the prelude lex | follow-up |

Parity stayed 58/58. Public API is still only `toMarkdown`.

## Residual

The leftover tails are native-code work Rust already does cheaply: DOC piece table / SPRM / iconv, XLS BIFF materialization, and RTF `Parser.run` on recovery fixtures (`unbalanced` 8.44×). Closing those to ~1× needs a native addon wrapping anydoc, which is out of scope.

`detect-reuse` (share detect's `Package` into parse) is a real second-open on tiny OOXML (~10% on those files) but does not move the corpus median and failed to beat a sequential remesure during the campaign.
