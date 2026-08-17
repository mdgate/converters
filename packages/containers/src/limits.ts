/** Maximum decompressed size of a single archive entry: 128 MiB. */
export const MAX_ENTRY_BYTES = 128 * 1024 * 1024;

/** Maximum total decompressed bytes read from one archive: 512 MiB. */
export const MAX_TOTAL_BYTES = 512 * 1024 * 1024;

/** Maximum number of entries in one archive. */
export const MAX_ENTRY_COUNT = 100_000;

/** Maximum XML element nesting depth. */
export const MAX_XML_DEPTH = 256;

/**
 * Maximum number of XML nodes (elements + text runs) in one part. Sized
 * from the measured worst-case DOM cost (~400 bytes/node) so a saturating
 * part stays around the archive budget.
 */
export const MAX_XML_NODES = 2_000_000;

/** Maximum nesting depth of binary record containers (legacy PPT stream). */
export const MAX_RECORD_DEPTH = 64;

/** Maximum total binary records visited in one legacy record stream. */
export const MAX_RECORDS = 16_000_000;
