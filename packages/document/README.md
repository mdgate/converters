# @mdgate/document

The shared document model (`Document`, blocks, inlines, tables, lists,
notes, assets) and its GitHub-Flavored-Markdown renderer
(`documentToMarkdown`).

Converters that use a document model parse bytes into a `Document` and
render it with this package, so they produce the same Markdown dialect.
To write your own converter on that path, implement the `Converter`
interface from `@mdgate/core` and build a `Document` with this package.
