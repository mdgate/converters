# mdgate vs anydoc speed (live remesure, label=r3)

In-process conversion only (`anydoc::to_markdown` / `toMarkdown`). Warmup 2 iterations discarded, then N=10 timed iterations per file (N=3 if warmup mean > 200 ms). No file crossed that threshold. Values are **median ms** of the timed iterations.

- Corpus: 54 well-formed fixtures under `anydoc/tests/fixtures` (excludes `abuse/` and `*--errors*`).
- Rust: reuse of `/tmp/anydoc-bench` release (`lto=thin`, `opt-level=3`) calling `anydoc::to_markdown` in one process. Includes file read + detect + convert. JSON: `/tmp/mdgate-close-gap/rust.json`.
- TypeScript: Node v22.21.1, compiled `dist/index.js` after `npm run build` (P0 `node:zlib` inflate/CRC + P1 `xml.ts` + P2 ODF empty-run / empty-origin already landed). Same loop in one long-lived process importing `dist` `toMarkdown`. JSON: `/tmp/mdgate-close-gap/ts-r3.json`.
- Timed: 2026-08-13, macOS aarch64, sequential (not concurrent). Both sides remesured in this run; old TS numbers were not reused. Rust was re-run (not reused from r1/r2).
- Label: **r3**.

## Per fixture

| fixture | rust_ms | ts_ms | ts/rust |
| --- | ---: | ---: | ---: |
| **csv/** | | | |
| csv/handmade-quoted.csv | 0.0596 | 0.1435 | 2.41× |
| csv/handmade-semicolon.csv | 0.0552 | 0.0558 | 1.01× |
| csv/handmade-utf16.csv | 0.0584 | 0.0695 | 1.19× |
| csv/sheet.csv | 0.0770 | 0.2053 | 2.67× |
| **doc/** | | | |
| doc/handmade-blockstyle.doc | 0.0209 | 0.1629 | 7.80× |
| doc/handmade-cyrillic.doc | 0.0172 | 0.0957 | 5.57× |
| doc/handmade-shiftjis.doc | 0.0151 | 0.0928 | 6.13× |
| doc/text.doc | 0.0973 | 0.8412 | 8.65× |
| **docx/** | | | |
| docx/handmade-altpath.docx | 0.0486 | 0.2537 | 5.22× |
| docx/handmade-blockstyle.docx | 0.0527 | 0.2409 | 4.57× |
| docx/handmade-manyrefs.docx | 0.1153 | 0.5991 | 5.20× |
| docx/handmade-numbering.docx | 0.1176 | 0.3944 | 3.35× |
| docx/handmade-ole.docx | 0.0451 | 0.0960 | 2.13× |
| docx/handmade-outline.docx | 0.0404 | 0.1301 | 3.22× |
| docx/handmade-rich.docx | 0.0771 | 0.2527 | 3.28× |
| docx/handmade-strict.docx | 0.0397 | 0.1078 | 2.71× |
| docx/handmade-tables.docx | 0.0389 | 0.1139 | 2.93× |
| docx/text.docx | 0.5564 | 1.131 | 2.03× |
| **epub/** | | | |
| epub/book.epub | 0.1222 | 0.4297 | 3.52× |
| epub/handmade-css-links.epub | 0.0714 | 0.2861 | 4.00× |
| epub/handmade-features.epub | 0.0581 | 0.2667 | 4.59× |
| **malformed/** | | | |
| malformed/brokenpersist--recovers.ppt | 0.0516 | 0.3025 | 5.86× |
| malformed/corrupt-styles--skips.docx | 0.2969 | 0.9606 | 3.24× |
| malformed/mismatched--recovers.docx | 0.0321 | 0.0620 | 1.93× |
| malformed/missing-styles--skips.docx | 0.2801 | 0.7105 | 2.54× |
| malformed/unbalanced--recovers.rtf | 0.0351 | 0.3377 | 9.63× |
| malformed/unclosed--recovers.docx | 0.0272 | 0.0751 | 2.76× |
| **odp/** | | | |
| odp/pres.odp | 0.3995 | 0.6559 | 1.64× |
| **ods/** | | | |
| ods/handmade-durations.ods | 0.0255 | 0.0891 | 3.49× |
| ods/handmade-gaps.ods | 0.0552 | 0.2193 | 3.97× |
| ods/sheet.ods | 0.1777 | 0.3663 | 2.06× |
| **odt/** | | | |
| odt/handmade-blockstyle.odt | 0.0336 | 0.0626 | 1.86× |
| odt/handmade-defaults.odt | 0.0256 | 0.0562 | 2.19× |
| odt/handmade-lists.odt | 0.0228 | 0.0570 | 2.50× |
| odt/handmade-manifestcomment.odt | 0.0197 | 0.0361 | 1.83× |
| odt/text.odt | 0.4590 | 0.6838 | 1.49× |
| **pdf/** | | | |
| pdf/text.pdf | 1.560 | 2.043 | 1.31× |
| **ppt/** | | | |
| ppt/handmade-multimaster.ppt | 0.0164 | 0.0768 | 4.68× |
| ppt/handmade-sparsenotes.ppt | 0.0162 | 0.0728 | 4.50× |
| ppt/pres.ppt | 0.0519 | 0.2389 | 4.60× |
| **pptx/** | | | |
| pptx/handmade-altpath.pptx | 0.0379 | 0.1096 | 2.89× |
| pptx/handmade-inherit.pptx | 0.0683 | 0.1985 | 2.91× |
| pptx/handmade-links.pptx | 0.0513 | 0.1230 | 2.40× |
| pptx/handmade-order.pptx | 0.0531 | 0.1185 | 2.23× |
| pptx/handmade-strict.pptx | 0.0416 | 0.0802 | 1.93× |
| pptx/pres.pptx | 0.3160 | 0.5367 | 1.70× |
| **rtf/** | | | |
| rtf/handmade-bin.rtf | 0.0376 | 0.1770 | 4.71× |
| rtf/handmade-blockstyle.rtf | 0.0175 | 0.0565 | 3.23× |
| rtf/handmade-cocoa.rtf | 0.0305 | 0.2258 | 7.40× |
| rtf/handmade-merge.rtf | 0.0184 | 0.1003 | 5.45× |
| rtf/text.rtf | 0.3298 | 1.021 | 3.10× |
| **xls/** | | | |
| xls/sheet.xls | 0.0372 | 0.2619 | 7.04× |
| **xlsx/** | | | |
| xlsx/handmade-merged.xlsx | 0.0383 | 0.0951 | 2.48× |
| xlsx/sheet.xlsx | 0.1106 | 0.3192 | 2.89× |

## By format folder (median of per-file medians)

| folder | n | rust_ms | ts_ms | ts/rust |
| --- | ---: | ---: | ---: | ---: |
| csv | 4 | 0.0590 | 0.1065 | 1.81× |
| doc | 4 | 0.0190 | 0.1293 | 6.79× |
| docx | 10 | 0.0506 | 0.2468 | 4.88× |
| epub | 3 | 0.0714 | 0.2861 | 4.00× |
| malformed | 6 | 0.0434 | 0.3201 | 7.38× |
| odp | 1 | 0.3995 | 0.6559 | 1.64× |
| ods | 3 | 0.0552 | 0.2193 | 3.97× |
| odt | 5 | 0.0256 | 0.0570 | 2.22× |
| pdf | 1 | 1.560 | 2.043 | 1.31× |
| ppt | 3 | 0.0164 | 0.0768 | 4.68× |
| pptx | 6 | 0.0522 | 0.1208 | 2.31× |
| rtf | 5 | 0.0305 | 0.1770 | 5.80× |
| xls | 1 | 0.0372 | 0.2619 | 7.04× |
| xlsx | 2 | 0.0744 | 0.2071 | 2.78× |

## Overall

| metric | rust_ms | ts_ms | ts/rust |
| --- | ---: | ---: | ---: |
| median of per-file medians | 0.0515 | 0.1877 | 3.65× |
| mean of per-file medians | 0.1215 | 0.3055 | 2.52× |
| sum of per-file medians | 6.559 | 16.50 | 2.52× |
| median of per-file ratios | — | — | 3.01× |
| mean of per-file ratios | — | — | 3.60× |
| files ok | 54/54 | 54/54 | |

Headline numbers: **rust median = 0.0515 ms**, **ts median = 0.1877 ms**, **ts/rust = 3.65**.

## Comparison to previous headline (after P0+P1+P2: rust 0.0484 / ts 0.1959 / 4.05×)

| | rust_ms | ts_ms | ts/rust | median of ratios |
| --- | ---: | ---: | ---: | ---: |
| previous headline (`bench-results-after.md`) | 0.0484 | 0.1959 | 4.05× | 3.29× |
| this remesure (r3) | 0.0515 | 0.1877 | 3.65× | 3.01× |
| r3 vs previous | +6.4% | -4.2% | -10.0% | -8.5% |

Both sides were remesured in-process this run. Rust median rose 0.0484 → 0.0515 (+6.4%); TS median fell 0.1959 → 0.1877 (−4.2%). Combined, the headline ratio moved **4.05× → 3.65×**. Median-of-ratios moved **3.29× → 3.01×**.

Median files this run: rust midpoint is `pptx/handmade-links.pptx` (0.0513 ms) / `malformed/brokenpersist--recovers.ppt` (0.0516 ms). TS midpoint is `rtf/handmade-bin.rtf` (0.1770 ms) / `pptx/handmade-inherit.pptx` (0.1985 ms).

**Where TypeScript is slowest relative to Rust**

| fixture | rust_ms | ts_ms | ts/rust |
| --- | ---: | ---: | ---: |
| malformed/unbalanced--recovers.rtf | 0.0351 | 0.3377 | 9.63× |
| doc/text.doc | 0.0973 | 0.8412 | 8.65× |
| doc/handmade-blockstyle.doc | 0.0209 | 0.1629 | 7.80× |
| rtf/handmade-cocoa.rtf | 0.0305 | 0.2258 | 7.40× |
| xls/sheet.xls | 0.0372 | 0.2619 | 7.04× |
| doc/handmade-shiftjis.doc | 0.0151 | 0.0928 | 6.13× |
| malformed/brokenpersist--recovers.ppt | 0.0516 | 0.3025 | 5.86× |
| doc/handmade-cyrillic.doc | 0.0172 | 0.0957 | 5.57× |

**Where TypeScript is closest**

| fixture | rust_ms | ts_ms | ts/rust |
| --- | ---: | ---: | ---: |
| csv/handmade-semicolon.csv | 0.0552 | 0.0558 | 1.01× |
| csv/handmade-utf16.csv | 0.0584 | 0.0695 | 1.19× |
| pdf/text.pdf | 1.560 | 2.043 | 1.31× |
| odt/text.odt | 0.4590 | 0.6838 | 1.49× |
| odp/pres.odp | 0.3995 | 0.6559 | 1.64× |
