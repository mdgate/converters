# mdgate performance plan

## Objective

Close the TypeScript vs Rust gap on the existing public API

```ts
export function toMarkdown(path: string): string
```

without losing fixture parity and without expanding that API.

Constraints that are not negotiable:

- Public surface stays exactly `toMarkdown`. No extra exports, no `@firecrawl/anydoc`, no wasm bindings, no native addon that wraps anydoc.
- Parity is a hard gate: `test/fixtures` except `abuse/` must keep matching `test/snapshots` (58/58 today). An optimization that cannot preserve that is not a candidate.
- Stay in TypeScript + Node builtins. Do not ship a native zip/xml/cfb addon unless a verified study proves it is the only remaining way — none did.

## Baseline (do not invent a new one)

End-to-end numbers from [`test/bench-results.md`](bench-results.md) (Node 22, warmup 2, N=10, 54 well-formed fixtures, one warm process):

| side | median of per-file medians |
| --- | ---: |
| Rust `anydoc::to_markdown` | 0.0548 ms |
| TS `toMarkdown` | 0.2214 ms |
| **TS / Rust** | **4.04×** |

Stage split from `node test/perf-scratch/profile-stages.mjs` (this-run e2e median 0.215 ms, matches the 0.221 ms bench):

| stage | median ms | share of e2e |
| --- | ---: | ---: |
| `parse` / `pdfToMarkdown` | 0.137 | 63.8% |
| `documentToMarkdown` | 0.025 | 11.5% |
| `readFileSync` | 0.014 | 6.5% |
| `formatFromBytes` / `formatFromPath` | 0.011 | 4.9% |

The 4× gap is parse, not I/O. TS parse alone (0.137 ms) is already ~2.5× Rust’s entire e2e. `Package.open` is a central-directory catalog (~0.002–0.006 ms) and is not the zip tax.

Where the parse time actually goes (profile + verified studies):

- **ZIP / OOXML / ODF / EPUB** (corpus majority, folder ratios ~3–5×): inflate (`fflate.Inflate` + the JS `crc32` loop in `archive.ts`) is 37–62% of parse on typical small pptx/xlsx/odt. `parseXml` (hand-rolled string lexer in `xml.ts`) grows with part size (`docx/text.docx` 37.2 KiB XML → 0.381 ms / 38% of parse; `odp/pres.odp` 70.5 KiB → 0.525 ms / 48%; `odt/text.odt` 0.297 ms / 43%). Format walk (styles / numbering / cascade) is the remainder. On tiny OOXML, detect is a first-class cost (25–36% of e2e) because `formatFromBytes` opens a second `Package` and inflates+parses identity parts.
- **RTF** (folder 6.71×, `handmade-cocoa.rtf` 11.82×): a single lexer drain is cheap. `parsePrelude` runs `destinationGroups` four times (full-file lex each). The rest is `Parser.run()` — cocoa’s 11.8× is the allocation-heavy RTF state machine, not the lexer inner loop.
- **XLS** 7.43×: `CompoundFile.open` is 2.7% of parse. Gap is the BIFF record walk + iconv + `sheetsToDocument`, not CFB open.
- **ODS `handmade-gaps`** 7.16×: inflate+xml are noise; table expansion/render of repeated empty cells is the file.
- **PDF** 1.33× and **CSV** ~1× are already close. Do not spend a P-slot on them.

## Recommended sequence

One sequence, ordered by **measured e2e gain per unit risk/effort**. Only verified studies (`measured: true`) are P-items.

| step | axis | effort | parity | why this rank |
| --- | --- | --- | --- | --- |
| **P0** | `zip-inflate` | S | medium | Corpus-wide. Inflate is the largest typical-file parse share. Native `zlib` is ~4× the current JS inflate+CRC. Detect’s second Package ride gets the same win for free. |
| **P1** | `xml-dom` | M | medium | Second zip tax. Independent of inflate, stacks with P0. 32% faster `parseXml` on the files that already show XML as 38–48% of parse. |
| **P2** | `odf-expand` | M | low | Tail only. The one verified fix for `ods/handmade-gaps.ods` (7.07× → 4.24×). Does **not** move the corpus median. Stop after P1 if the only goal is the 4.04× headline. |

**Stop after P1 for the headline ratio.** Land P2 only if the gaps tail is still in scope.

### What to skip (verified, not worth a P-slot)

- **`render-strings` as its own patch.** The study’s own recommendation is “Do not patch `mdgate/src`.” The only isolated win is a `renderCell` empty-origin fast path, and that is already inside P2. Render is <15% of e2e on `docx/text.docx` and `rtf/text.rtf`. Do not rewrite `escapeText`, adopt a rope/`StringBuilder`, or share a global output buffer.
- **`cfb-ole` rewrite.** Do not rewrite CFB (`Uint32Array` FAT, bitmap chains, dir index). Do not wrap `rust-cfb` or calamine. CFB open is 2–19% of OLE parse and is not the 7.43×. The optional S patch (batch iconv per compressed Word piece + pass detect’s `CompoundFile` into parse; do not preallocate 128 MiB for directory chains) is real on `handmade-shiftjis.doc` / `handmade-cyrillic.doc` and a no-op on `xls/sheet.xls` e2e (0.4672 → 0.4585). Leave it as a later hygiene patch, not this sequence.
- **Wrapping anydoc / wasm / a native addon.** Out of scope. No verified study showed it was required. P0 uses Node’s already-present `node:zlib`; that is a builtin, not an addon.

### What not to mix into these patches

Each axis is scoped. Do not smuggle a second axis into the first PR.

- Do not share detect’s `Package` / `CompoundFile` into parse inside P0 or the CFB hygiene patch (separate, unverified).
- Do not drop CRC. Rust `zip` 8.6 checks it.
- Do not replace `Attr[]` with `Map`, swap in a third-party XML parser, or flatten `XmlNode` in P1.
- Do not drop interior empty ODS slots or change coordinates (snapshot is 122 rows × 1012 cols of GFM padding).
- Do not touch `pdf.ts` / `officeart.ts` `fflate` paths. Do not remove `fflate` from `package.json`.

---

## P0 — `zip-inflate` (do first)

**Files:** `src/internal/package/archive.ts` only. Guard or engines bump in `package.json`.

**Current code (verified by read):** `inflateCapped` streams `fflate.Inflate` into a chunk list; `crc32` is a per-byte JS table walk.

```294:312:src/internal/package/archive.ts
function inflateCapped(data: Uint8Array, maxOut: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  let overflow = false;
  const inf = new Inflate((chunk) => {
    // ... cap at maxOut ...
  });
  inf.push(data, true);
  return concat(chunks, total);
}
```

```435:441:src/internal/package/archive.ts
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
```

**Concrete change:**

1. Replace `fflate.Inflate` in `decompress` with `node:zlib` `inflateRawSync({ maxOutputLength: maxOut })`.
2. Replace the JS CRC table with `zlib.crc32`. `zlib.crc32` landed in Node 20.15 / 22 — either guard (`typeof zlib.crc32 === 'function' ? zlib.crc32 : jsCrc32`) or bump `engines.node` past `20.15`. Current `engines` is `>=20`.
3. Map `ERR_BUFFER_TOO_LARGE` to a `maxOut`-length buffer so the existing cap+1 `resourceLimit` path still fires.
4. Return empty on 0-byte input (`fflate` does; zlib throws `Z_BUF_ERROR`). Empty/truncated raw deflate is the parity footgun; the fixture tree including `abuse/` has no empty method-8 entries, but the branch must exist.
5. Keep the CRC check when `entry.crc !== 0` (Rust does).
6. Leave `pdf.ts` / `officeart.ts` on `fflate`. Do not drop the `fflate` dependency.

**Expected e2e effect** (commands already run in `/tmp/mdgate-opt-zip-inflate`, Node v22.21.1; not re-invented here):

| measurement | current | proto |
| --- | ---: | ---: |
| Isolated inflate (`Package.open` + parse-read parts), median of the two large files | 0.2638 ms | 0.0658 ms |
| `docx/text.docx` inflate | 0.2539 | 0.0662 |
| `odp/pres.odp` inflate | 0.2738 | 0.0653 |
| Isolated CRC, `docx/text.docx` | 0.0785 | 0.0025 (`zlib.crc32`) |
| Isolated CRC, `odp/pres.odp` | 0.1388 | 0.0034 |
| `docx/text.docx` e2e (5× warmup 2 N=10, median-of-medians) | 1.1421 | 0.9938 |
| `odp/pres.odp` e2e | 0.9534 | 0.7453 |
| Those two vs Rust 0.5625 / 0.4846 (sum of ratios) | **2.00×** | **1.66×** |

Raw inflate `fflate` vs `inflateRawSync`: 0.266 vs 0.086 (`docx`), 0.169 vs 0.054 (`odp`). `fflate.inflateSync` is only ~15% faster than streaming `Inflate` and is **not** the win; zlib is ~3×.

On typical small zip files inflate is 37–62% of parse and detect re-inflates identity parts (25–36% of e2e). Those files should drop **more** as a percentage than the two large parts above. Profile examples: `pptx/handmade-strict.pptx` inflate is 64.5% of parse; `pptx/pres.pptx` 44.9%; `xlsx/sheet.xlsx` 48.1%.

This axis does **not** close the 4× corpus gap by itself — XML + format walk remain.

**Parity to re-run after the patch:**

- `npm test` (includes `test/foundation-b.test.ts` xml/detect and ConvertError `resourceLimit`).
- `npx tsx test/parity.ts` — 58/58 vs `anydoc/tests/snapshots` excluding `abuse/`. Proto already matched current `toMarkdown` on 54/54 well-formed fixtures; still re-run the full harness (malformed / `--recovers` / `--skips` / `--errors` included).
- Targeted: empty method-8 buffer, oversize entry (`max_entry_bytes`), CRC mismatch still throws, `probeOle` unchanged.

**Why this beat the alternatives:**

- Highest e2e gain per hour: S effort, one file, corpus majority.
- Native inflate is what Rust already does (`flate2` / `zlib-rs`). Same algorithm, same CRC policy.
- Detect’s second open is the same `decompress` — no detect-cache design required for this win.
- Rejected: wasm zip, native addon, skipping CRC, `fflate.inflateSync` as the “optimization”, async zlib, sharing detect’s `Package` into parse.

---

## P1 — `xml-dom` (do second)

**Files:** `src/internal/package/xml.ts` only.

**Current code (verified by read):** every element `NsScope.push()` allocates a new `Map`; the lexer allocates a fresh `Event` object per token and builds text with `out += this.s[this.i]`; `childElems()` / `find` / `findAll` allocate a filtered array on every call; only ns URIs are interned.

```88:102:src/internal/package/xml.ts
  childElems(): Element[] {
    const out: Element[] = [];
    for (const n of this.children) {
      if (n.type === 'elem') out.push(n.elem);
    }
    return out;
  }
```

```166:173:src/internal/package/xml.ts
class NsScope {
  private readonly prefixes: Map<string, string | undefined>[] = [new Map()];
  private defaultNs: (string | undefined)[] = [undefined];

  push(): void {
    this.prefixes.push(new Map());
    this.defaultNs.push(this.defaultNs[this.defaultNs.length - 1]);
  }
```

**Concrete change** (all in `xml.ts`, keep the `Element` / `Attr[]` / `attr()` / `attrAny()` contract):

1. **NsScope copy-on-write.** `push()` reuses the parent prefix map; allocate a new `Map` only when an `xmlns*` declaration is actually applied. Office parts are almost all xmlns-free children.
2. **Lexer writes into reused fields** instead of allocating an `Event` object per token.
3. **Slice text runs and attribute values** from the already-decoded UTF-8 string. Slow-path unescape only when `'&'` is present. Today `textRun()` appends character-by-character.
4. **Intern local names** (ns URIs are already interned). Do not intern attribute values.
5. **`find` / `findAll` scan `children` in place.** Cache `childElems()` after parse. Share `EMPTY_ATTRS`.
6. **Keep `Attr[]` and linear `attr()` / `attrAny()`.** Office parts average 0.8–2.7 attrs (max 36). Building a `Map` is slower than a 1–4 element scan (`buildMap` 0.39–0.57 ms vs linear 0.13–0.15 ms at 1–4 attrs).

**Expected e2e effect** (`node /tmp/mdgate-opt-xml-dom/measure-e2e.mjs`, Node v22.21.1, warmup 2, N=10, 8 process warms):

| measurement | current | proto |
| --- | ---: | ---: |
| `parseXml` median (the measured XML-heavy set) | 0.4761 ms | 0.3242 ms |
| `parseXml` `docx/text.docx` | 0.3935 | 0.2498 |
| `parseXml` `odp/pres.odp` | 0.5586 | 0.3985 |
| `docx/text.docx` e2e (rust 0.5625) | 1.4659 → 2.61× | 1.1722 → 2.08× |
| `odp/pres.odp` e2e (rust 0.4846) | 1.1440 → 2.36× | 0.8539 → 1.76× |
| Median ratio of that pair | **2.48×** | **1.92×** |

DOM dump was equal on all XML parts of `text.docx` / `pres.odp` / `text.odt` / `sheet.xlsx` / `pres.pptx`.

P1 stacks with P0: they attack different parse slices. Independent measurements used different JIT baselines (do not add the ms columns). A stacked estimate for `docx/text.docx` using the **profile** split (parse 1.0077 = inflate 0.2104 + xml 0.3808 + walk 0.4109) plus the two proto factors:

- inflate 0.2104 → ~0.066 (P0 factor)
- xml 0.3808 → ~0.242 (P1 factor)
- walk unchanged ~0.411
- parse ~0.72 vs 1.01; detect also cheaper after P0

That is a per-file estimate, not a new measurement. Remesure the corpus after P0+P1.

This axis cannot close the 4× gap alone: inflate + format walk remain larger on typical zip files.

**Parity to re-run:**

- `npm test` — especially `test/foundation-b.test.ts` (`resolves namespaces regardless of prefix`, Strict OOXML, `Requires` prefix rewrite, unclosed recovery, `max_xml_depth`).
- `npx tsx test/parity.ts` — 58/58. XML recovery on `malformed/unclosed--recovers.docx` and `malformed/mismatched--recovers.docx` is the footgun.
- Optional DOM dump of the same five packages used in the study, before/after.

**Why this beat the alternatives:**

- Second-largest verified zip win, and the only one that is still live after P0.
- Staying inside `xml.ts` keeps the format walk’s `Element` contract intact (medium — not low — parity risk).
- Rejected: `Attr[]` → `Map` (microbench lost), third-party parser (parity), flattening `XmlNode` in the first patch, interning attribute values.

---

## P2 — `odf-expand` (tail only; after P0+P1)

**Files:**

- `src/internal/formats/odf/table.ts`
- `src/internal/model/table.ts`
- `src/internal/render/table.ts`
- `src/internal/render/anchors.ts`
- `src/internal/render/index.ts`
- `src/internal/formats/odf/text.ts` is read-only. `header.ts` is not hot.

**Current code (verified by read):** empty ODF column/row repeats call `builder.place(emptyCell())` in a JS loop; non-empty repeats `structuredClone` even when `repeat == 1`; render walks every origin through `renderCell`.

```240:246:src/internal/formats/odf/table.ts
function flushGap(state: TableState, pending: number): void {
  if (pending === 0) return;
  charge(state, pending);
  for (let i = 0; i < pending; i += 1) {
    state.builder.place(emptyCell());
  }
}
```

`ods/handmade-gaps.ods` is 120 interior empty rows + 1010 interior empty cells (500/200 trailing elided). Snapshot is a 122 × 1012 GFM table. Walk is 80% of parse (0.113 ms); `documentToMarkdown` is 0.238 ms / 58% of e2e.

**Concrete change:**

1. Keep interior empty-run **materialization** (parity — do not drop slots or change coordinates).
2. Add `GridBuilder.placeEmptyRun` / `nextRows` and a 1×1 `place` fast path.
3. ODF `flushGap` / pending rows use those helpers.
4. Skip `structuredClone` when `cell.repeat == 1`.
5. `renderTable`: skip `renderCell` on empty origins; emit empty / separator GFM rows with `String.repeat`.
6. Skip empty origins in anchor / note walks.

**Expected e2e effect** (`node /tmp/mdgate-opt-odf-expand/bench-e2e.mjs` on `{mdgate,proto}/dist`, warmup 2, N=10):

| `ods/handmade-gaps.ods` | current | proto |
| --- | ---: | ---: |
| walk | 0.0939 ms | 0.0498 ms |
| parse | 0.227 | 0.163 |
| render | 0.219 | 0.106 |
| stage e2e | 0.463 | 0.278 |
| vs rust 0.0655 (`bench-results.md`) | **7.07×** | **4.24×** |

`sheet.ods` (29 cells) e2e 0.617 → 0.499 — expand is not that file’s limiter. Proto markdown matched current on 54/54. **Corpus median will barely move.**

**Parity to re-run:**

- `npm test` — `test/model.test.ts` `GridBuilder` + `test/render.test.ts` tables.
- `npx tsx test/parity.ts` — 58/58, with a hard look at `ods/handmade-gaps.ods`, `ods/handmade-durations.ods`, `ods/sheet.ods`.
- Do not touch `MAX_EXPANSION`, header inference, or public API.

**Why this beat the alternatives:**

- It is the only verified study that moves a named 7× file without changing snapshot geometry.
- It absorbs the only `render-strings` win (empty-origin `renderCell` skip).
- Rejected: dropping interior empty slots, treating `structuredClone` or styles as the gaps win, rewriting render strings globally.

Land P2 after P0+P1 so remesure of the tail is not confounded by the zip tax.

---

## Residual TS / Rust ratio

Not 1.0×. Nothing measured gets us there, and the leftover work is the expensive part of several tails.

**Point estimate after P0+P1 (and P2, which does not move the median): ~2.8×** corpus median of per-file medians.

Range to quote until remesured: **2.5–3.2×**.

How that number is derived (stacked estimate, **not** a new corpus run):

1. Today: 0.2214 / 0.0548 = 4.04×.
2. P0 cut 13% and 22% e2e on the two large zip files (1.1421 → 0.9938, 0.9534 → 0.7453). On small OOXML, inflate+detect is a **larger** share (detect 25–36% of e2e, inflate 37–64% of parse), so the median file — a small pptx/xlsx-class fixture around 0.22 ms — should drop more than those large-file percentages, not less.
3. P1 is a further ~20% e2e on XML-heavy parts, less on tiny parts where inflate dominates.
4. Combining the profile split with the two proto factors, a representative near-median zip (`pptx/handmade-order.pptx`: detect 0.0614, inflate 0.0783, xml 0.0275, walk 0.0200, e2e 0.2219 / rust 0.0495 = 4.48×) lands around ~2.2–2.5× if detect’s inflate share is ~50–60%. Non-zip files (RTF, XLS, DOC, CSV, PDF) do not move. The new median of 54 files is pulled by that mix to **about 2.8×**.
5. P2 moves one file from 7.16× toward 4.24× and does not change the median.

**What remains after the sequence (why not 2.0×, and why not 1.0×):**

| leftover | evidence it survives P0–P2 |
| --- | --- |
| Format walk (styles / numbering / cascade) | 15–40% of zip parse; no verified study. `docx/text.docx` walk 0.411 ms would still exceed Rust’s whole 0.563 ms e2e. |
| RTF `Parser.run` / `CharState` | cocoa 11.82×: lexer is 3.2% of parse, prelude 14%, the rest is the state machine. Not in this sequence. |
| XLS BIFF + `sheetsToDocument` | 7.43×. CFB open is 2.7%. The verified CFB study refused to rewrite this. |
| Detect’s second `Package` / `CompoundFile` | Cheaper after P0, still a second catalog + identity inflate/xml. Not a verified axis. |
| PDF | Already 1.33×. Not the median. |
| JS allocation floor vs Rust | Tiny fixtures convert in well under 1 ms; a fixed per-call floor remains. |

**Mandatory remesure after P0 and after P0+P1**, same protocol as `test/bench-results.md` (warmup 2, N=10, 54 well-formed fixtures, one warm process). Update the headline from that run, not from this estimate.

---

## Implementation / verification loop (every P-item)

1. Patch only the listed files. Keep prototypes out of `src/` until the change is the one landing; scratch stays under `test/perf-scratch/` or `/tmp`.
2. `npm test`.
3. `npx tsx test/parity.ts` — require 58/58. Fail the patch if a snapshot moves.
4. Remesure at least the study’s own files plus the corpus median (`node test/perf-scratch/profile-stages.mjs` and the bench loop that produced `test/bench-results.md`).
5. Do not commit from this plan. Do not export new symbols.

Public API check: `src/index.ts` remains `export { toMarkdown } from './to-markdown.js'`.

---

## Appendix — not in the recommended sequence

### A. Measured return that is not a P-item here: `rtf-lexer-alloc`

Returned with `measured: true` / `ok: true`, but it is **not** in the verified-study set this plan is allowed to sequence. Do not implement it as P3 until it is accepted as verified in-tree. Recorded so it is not rediscovered from scratch.

**Proposed change** (lexer.ts only): `Buffer.latin1Slice` instead of `asciiSlice`; parse ≤10-digit control params as integers and keep the BigInt i64-clamp only for longer runs; reuse stable per-kind token objects (do not mutate one fat object’s string `type`); intern control-word names in a prefix trie; `destinationGroups` switches on a numeric kind. Public `Token` shape stays `{type,name,param,byte,payload}`.

**Measured** (`node /tmp/mdgate-opt-rtf-lexer-alloc/measure-one.mjs`, warmup 2, N=10): `text.rtf` lex 0.1279 → 0.0585 ms; e2e 1.422 → 0.980 (4.21× → 2.90× vs rust 0.338). Cocoa e2e 0.247 → 0.211 (8.31× → 7.10×). Ablation: latin1+fastParam 0.095 vs current 0.139 on `text.rtf` drain.

**Why it is not P0–P2:** it does not move the corpus median; it does not fix cocoa 11.8× (`Parser.run` / `CharState` clone is still ~80% of cocoa parse); prelude’s four full-file `destinationGroups` scans are a different axis. If it is later verified, it is an S / low-parity follow-up **after** P0+P1, not instead of them.

Do not push numeric word IDs through `Parser.controlWord` / `tables.ts`. Do not drop the i64 overflow path.

### B. Unverified (profile-identified, no accepted study)

Do not schedule these as P-items. They may be studied later; they are not a plan.

- **Share detect’s `Package` / `CompoundFile` into parse** so e2e does not open the container twice. Mentioned as a separate axis by both the zip and CFB studies. On tiny OOXML, detect is 25–36% of e2e; after P0 the leftover is catalog + xml of identity parts, not JS inflate. Lifetime / cache-invalidation / encrypted-package probe make this medium parity. Measure first.
- **RTF prelude fusion** — fold the four `destinationGroups` scans (`fonttbl`, `stylesheet`, `listtable`, `listoverridetable`) into one lex. Profile: prelude is 42% of `text.rtf` parse (0.495 ms). Not measured as a patch.
- **RTF `Parser.run` / `CharState` clone** — the cocoa 11.82×. Lexer work will not fix it.
- **OOXML / ODF format walk** (styles, numbering, cascade) — the remainder after P0+P1. `docx/text.docx` walk 0.411 ms. No prototype.
- **XLS BIFF + `sheetsToDocument`** — the 7.43×. CFB study explicitly refused to rewrite this under that axis.
- **Detect-only identity inflate/xml** after P0 — may collapse into the shared-Package study.

### C. Explicitly rejected (scope)

- Wrapping anydoc from Node (`@firecrawl/anydoc`, napi, wasm, a native zip/xml/cfb addon).
- Exporting anything other than `toMarkdown`.
- Replacing the hand-rolled XML parser with a third-party one in the first XML patch.
- Skipping CRC, dropping `fflate` (PDF / OfficeArt still need it), async zlib.
- Preallocating `MAX_ENTRY_BYTES` (128 MiB) for CFB directory chains.
- Reading unused OLE streams (`pres.ppt` `SummaryInformation` 442604 B is unread, correctly).
- Changing snapshot geometry for ODS empty cells.

---

## Sources (commands / artifacts this plan is allowed to cite)

- [`test/bench-results.md`](bench-results.md) — e2e baseline, 54/54, rust median 0.0548 ms, TS 0.2214 ms, 4.04×.
- `node test/perf-scratch/profile-stages.mjs` — stage split, this-run e2e median 0.215 ms.
- Verified studies: `zip-inflate` (`/tmp/mdgate-opt-zip-inflate`), `xml-dom` (`/tmp/mdgate-opt-xml-dom`), `odf-expand` (`/tmp/mdgate-opt-odf-expand`), `cfb-ole`, `render-strings`. All `measured: true`.
- Read of `src/internal/package/archive.ts`, `src/internal/package/xml.ts`, `src/internal/formats/odf/table.ts`, `src/internal/formats/rtf/lexer.ts`, `src/internal/detect.ts`, `src/to-markdown.ts`, `src/index.ts`, `package.json`, `test/parity.ts`.
