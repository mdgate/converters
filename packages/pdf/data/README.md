# Official mapping sources

Build-time inputs for `scripts/gen-maps.py`. Regenerates `src/generated/*`.

| File | Source |
| --- | --- |
| `EquivalentUnifiedIdeograph.txt` | Unicode UCD (Equivalent_Unified_Ideograph) |
| `glyphlist.txt`, `zapfdingbats.txt` | Adobe Glyph List |
| `Adobe-*-UCS2` | Adobe mapping-resources-pdf `pdf2unicode` (CID → Unicode) |
| `cmaps/` | Adobe cmap-resources legacy Encoding CMaps (byte → CID). Uni* encodings are decoded as UTF-8/16/32 and are not stored here. |
| `encodings.js` | ISO 32000 Annex D encoding names (pdf.js layout) |

These are not a “complete Unicode character inventory”. Unicode is the *output* of PDF decoding. The files here are the official *equivalence* and *encoding* tables that map PDF codes and lookalike code points onto that output.

`scripts/gen-maps.py` packs them into `src/generated/maps.bin` (zlib). That file is what `@mdgate/pdf` loads at runtime — it is not inlined as base64 inside `dist/index.js`.
