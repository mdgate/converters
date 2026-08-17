# @mdgate/document

The shared document model (`Document`, blocks, inlines, tables, lists,
notes, assets) and its GitHub-Flavored-Markdown renderer
(`documentToMarkdown`).

Converter packages parse bytes into a `Document` and render it with this
package, so every converter — official or third-party — produces the same
Markdown dialect. To write your own converter, implement the `Converter`
interface from `@mdgate/core` and build a `Document` with this package.
