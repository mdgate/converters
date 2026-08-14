# mdgate vs anydoc speed

In-process conversion only (`anydoc::to_markdown` / `toMarkdown`). Warmup 2 iterations discarded, then N=10 timed iterations per file (N=3 if warmup mean > 200 ms). No file crossed that threshold. Values are **median ms** of the timed iterations.

- Corpus: 54 well-formed fixtures under `anydoc/tests/fixtures` (excludes `abuse/` and `*--errors*`).
- Rust: release `anydoc-bench` (`lto=thin`, `opt-level=3`) calling `anydoc::to_markdown` in one process. Includes file read + detect + convert.
- TypeScript: Node 22, compiled `dist/index.js`, same loop in one long-lived process.
- Timed: 2026-08-13, macOS aarch64, sequential (not concurrent).

## Per fixture

| fixture | rust_ms | ts_ms | ts/rust |
| --- | ---: | ---: | ---: |
| **csv/** | | | |
| csv/handmade-quoted.csv | 0.1413 | 0.1720 | 1.22× |
| csv/handmade-semicolon.csv | 0.1239 | 0.0775 | 0.63× |
| csv/handmade-utf16.csv | 0.1243 | 0.0914 | 0.74× |
| csv/sheet.csv | 0.1484 | 0.2036 | 1.37× |
| **doc/** | | | |
| doc/handmade-blockstyle.doc | 0.0436 | 0.1605 | 3.68× |
| doc/handmade-cyrillic.doc | 0.0387 | 0.0981 | 2.53× |
| doc/handmade-shiftjis.doc | 0.0194 | 0.0919 | 4.74× |
| doc/text.doc | 0.2291 | 0.8649 | 3.78× |
| **docx/** | | | |
| docx/handmade-altpath.docx | 0.1148 | 0.4735 | 4.12× |
| docx/handmade-blockstyle.docx | 0.1229 | 0.4087 | 3.33× |
| docx/handmade-manyrefs.docx | 0.2684 | 0.7939 | 2.96× |
| docx/handmade-numbering.docx | 0.1540 | 0.5185 | 3.37× |
| docx/handmade-ole.docx | 0.0536 | 0.2082 | 3.89× |
| docx/handmade-outline.docx | 0.0560 | 0.1816 | 3.24× |
| docx/handmade-rich.docx | 0.1527 | 0.4411 | 2.89× |
| docx/handmade-strict.docx | 0.0509 | 0.2027 | 3.98× |
| docx/handmade-tables.docx | 0.0533 | 0.1712 | 3.21× |
| docx/text.docx | 0.5625 | 1.567 | 2.79× |
| **epub/** | | | |
| epub/book.epub | 0.1762 | 0.6153 | 3.49× |
| epub/handmade-css-links.epub | 0.0983 | 0.4266 | 4.34× |
| epub/handmade-features.epub | 0.0792 | 0.3267 | 4.12× |
| **malformed/** | | | |
| malformed/brokenpersist--recovers.ppt | 0.0761 | 0.2922 | 3.84× |
| malformed/corrupt-styles--skips.docx | 0.3770 | 1.226 | 3.25× |
| malformed/mismatched--recovers.docx | 0.0370 | 0.1276 | 3.45× |
| malformed/missing-styles--skips.docx | 0.3507 | 1.018 | 2.90× |
| malformed/unbalanced--recovers.rtf | 0.0439 | 0.3621 | 8.25× |
| malformed/unclosed--recovers.docx | 0.0349 | 0.1426 | 4.08× |
| **odp/** | | | |
| odp/pres.odp | 0.4846 | 1.136 | 2.34× |
| **ods/** | | | |
| ods/handmade-durations.ods | 0.0299 | 0.1313 | 4.39× |
| ods/handmade-gaps.ods | 0.0655 | 0.4689 | 7.16× |
| ods/sheet.ods | 0.1930 | 0.6045 | 3.13× |
| **odt/** | | | |
| odt/handmade-blockstyle.odt | 0.0302 | 0.0944 | 3.12× |
| odt/handmade-defaults.odt | 0.0245 | 0.0853 | 3.49× |
| odt/handmade-lists.odt | 0.0251 | 0.0731 | 2.92× |
| odt/handmade-manifestcomment.odt | 0.0195 | 0.0548 | 2.81× |
| odt/text.odt | 0.2763 | 0.8757 | 3.17× |
| **pdf/** | | | |
| pdf/text.pdf | 1.538 | 2.039 | 1.33× |
| **ppt/** | | | |
| ppt/handmade-multimaster.ppt | 0.0169 | 0.0759 | 4.50× |
| ppt/handmade-sparsenotes.ppt | 0.0166 | 0.0790 | 4.75× |
| ppt/pres.ppt | 0.0536 | 0.2535 | 4.73× |
| **pptx/** | | | |
| pptx/handmade-altpath.pptx | 0.0405 | 0.2051 | 5.06× |
| pptx/handmade-inherit.pptx | 0.0679 | 0.3305 | 4.87× |
| pptx/handmade-links.pptx | 0.0495 | 0.2209 | 4.47× |
| pptx/handmade-order.pptx | 0.0495 | 0.2219 | 4.48× |
| pptx/handmade-strict.pptx | 0.0401 | 0.1657 | 4.13× |
| pptx/pres.pptx | 0.2928 | 0.9895 | 3.38× |
| **rtf/** | | | |
| rtf/handmade-bin.rtf | 0.0346 | 0.1994 | 5.76× |
| rtf/handmade-blockstyle.rtf | 0.0163 | 0.0629 | 3.85× |
| rtf/handmade-cocoa.rtf | 0.0297 | 0.3511 | 11.82× |
| rtf/handmade-merge.rtf | 0.0184 | 0.0883 | 4.79× |
| rtf/text.rtf | 0.3380 | 1.512 | 4.47× |
| **xls/** | | | |
| xls/sheet.xls | 0.0351 | 0.2605 | 7.43× |
| **xlsx/** | | | |
| xlsx/handmade-merged.xlsx | 0.0358 | 0.1730 | 4.84× |
| xlsx/sheet.xlsx | 0.1045 | 0.5038 | 4.82× |

## By format folder (median of per-file medians)

| folder | n | rust_ms | ts_ms | ts/rust |
| --- | ---: | ---: | ---: | ---: |
| csv | 4 | 0.1328 | 0.1317 | 0.99× |
| doc | 4 | 0.0412 | 0.1293 | 3.14× |
| docx | 10 | 0.1189 | 0.4249 | 3.58× |
| epub | 3 | 0.0983 | 0.4266 | 4.34× |
| malformed | 6 | 0.0600 | 0.3272 | 5.45× |
| odp | 1 | 0.4846 | 1.136 | 2.34× |
| ods | 3 | 0.0655 | 0.4689 | 7.16× |
| odt | 5 | 0.0251 | 0.0853 | 3.40× |
| pdf | 1 | 1.538 | 2.039 | 1.33× |
| ppt | 3 | 0.0169 | 0.0790 | 4.68× |
| pptx | 6 | 0.0495 | 0.2214 | 4.47× |
| rtf | 5 | 0.0297 | 0.1994 | 6.71× |
| xls | 1 | 0.0351 | 0.2605 | 7.43× |
| xlsx | 2 | 0.0701 | 0.3384 | 4.83× |

## Overall

| metric | rust_ms | ts_ms | ts/rust |
| --- | ---: | ---: | ---: |
| median of per-file medians | 0.0548 | 0.2214 | 4.04× |
| mean of per-file medians | 0.1418 | 0.4170 | 2.94× |
| sum of per-file medians | 7.657 | 22.52 | 2.94× |
| median of per-file ratios | — | — | 3.81× |
| mean of per-file ratios | — | — | 3.93× |
| files ok | 54/54 | 54/54 | |

Headline numbers used below: **rust median = 0.0548 ms**, **ts median = 0.2214 ms**, **ts/rust = 4.04**.

## Reading

Startup is not in these numbers: both sides loop inside one already-warm process. The fixtures are tiny (most convert in well under 1 ms), so the ratios mix real parser work with a fixed floor of `fs.readFile` + format detection.

**Where TypeScript is slowest relative to Rust**

| fixture | rust_ms | ts_ms | ts/rust |
| --- | ---: | ---: | ---: |
| rtf/handmade-cocoa.rtf | 0.0297 | 0.3511 | 11.82× |
| malformed/unbalanced--recovers.rtf | 0.0439 | 0.3621 | 8.25× |
| xls/sheet.xls | 0.0351 | 0.2605 | 7.43× |
| ods/handmade-gaps.ods | 0.0655 | 0.4689 | 7.16× |
| rtf/handmade-bin.rtf | 0.0346 | 0.1994 | 5.76× |
| pptx/handmade-altpath.pptx | 0.0405 | 0.2051 | 5.06× |
| pptx/handmade-inherit.pptx | 0.0679 | 0.3305 | 4.87× |
| xlsx/handmade-merged.xlsx | 0.0358 | 0.1730 | 4.84× |

**Where TypeScript is closest**

| fixture | rust_ms | ts_ms | ts/rust |
| --- | ---: | ---: | ---: |
| csv/handmade-semicolon.csv | 0.1239 | 0.0775 | 0.63× |
| csv/handmade-utf16.csv | 0.1243 | 0.0914 | 0.74× |
| csv/handmade-quoted.csv | 0.1413 | 0.1720 | 1.22× |
| pdf/text.pdf | 1.538 | 2.039 | 1.33× |
| csv/sheet.csv | 0.1484 | 0.2036 | 1.37× |

**Why**

- **PDF** (`pdf/text.pdf`): Rust 1.538 ms vs TS 2.039 ms (1.33×). Rust uses native `pdf-inspector` / `lopdf`; the TypeScript port walks objects and streams in JS. This is the slowest single file on both sides, but the gap is small because the fixture is a one-page text PDF.
- **ZIP / OOXML / ODF / EPUB** (docx, pptx, xlsx, odt, ods, odp, epub): folder medians ~4.93×. Rust inflates with native `flate2`/`zlib-rs` and parses XML with `quick-xml`; TS inflates with pure-JS `fflate` and walks XML in a hand-rolled parser. The extra cost is inflate + the JS XML/relationship/style walk, not process startup.
- **Regex / RTF**: RTF is a token stream. Rust median 0.0322 ms vs TS 0.2752 ms (8.56×). `text.rtf` is 4.5×; the lexer is allocation-heavy in JS. No regex engine is on the hot path the way a Turndown-style HTML convertor would be — the port is a character lexer.
- **OLE / CFB** (doc, ppt, xls): TypeScript is 3.50× the Rust median. Binary sector walks and encoding (iconv-lite vs encoding_rs) show up more than zip, because there is no shared native inflate to hide behind.
- **CSV**: closest family (0.99×). Tiny files, almost all I/O + a linear scan; JS is competitive and sometimes faster on the smallest semicolon/utf16 cases.
- **Startup** is excluded. A cold `cargo run --example convert` or a one-shot `node -e` would add tens to hundreds of ms of process and JIT/load overhead that these tables do not include.
