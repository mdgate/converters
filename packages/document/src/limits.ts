/** Maximum content-bearing cells a repeat expansion may produce per table. */
export const MAX_EXPANSION = 4_000_000;

/**
 * Maximum total text bytes duplicated by repeat expansion per document:
 * 64 MiB.
 */
export const MAX_EXPANSION_TEXT_BYTES = 64 * 1024 * 1024;

/** Maximum total bytes of embedded assets retained in a Document: 128 MiB. */
export const MAX_ASSET_TOTAL_BYTES = 128 * 1024 * 1024;
