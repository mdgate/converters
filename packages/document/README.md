# @mdgate/document

The shared document model (`Document`, blocks, inlines, tables, lists,
notes, assets) and its GitHub-Flavored-Markdown renderer
(`documentToMarkdown`).

Parsers may build a `Document` and render it with this package, so they
produce the same Markdown dialect. To use it, implement `Converter` from
`@mdgate/core` and build a `Document` with this package.
