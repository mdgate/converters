/** Index into `Document.assets`. */
export type AssetId = number;

/**
 * An embedded binary asset (image, object payload). Bytes are always
 * retained so the document stays self-contained; total retained bytes are
 * capped by `max_asset_total_bytes` at parse time.
 */
export interface Asset {
  id: AssetId;
  mediaType: string;
  originPart: string;
  bytes: Uint8Array;
}
