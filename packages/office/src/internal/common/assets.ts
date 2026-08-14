import { ConvertError } from '../error.js';
import type { Asset, AssetId, ImageSource } from '../model/index.js';
import type { Package } from '../package/archive.js';
import { MAX_ASSET_TOTAL_BYTES } from '../package/limits.js';
import { type Relationships, relTargetBytes } from '../package/relationships.js';

export class AssetSink {
  assets: Asset[] = [];
  private readonly byPart = new Map<string, AssetId>();
  total = 0;

  add(mediaType: string, originPart: string, bytes: Uint8Array): AssetId {
    const existing = this.byPart.get(originPart);
    if (existing !== undefined) return existing;
    this.total += bytes.length;
    if (this.total > MAX_ASSET_TOTAL_BYTES) {
      throw ConvertError.resourceLimit(
        'max_asset_total_bytes',
        'embedded assets exceed the retained-bytes cap',
      );
    }
    const id = this.assets.length;
    this.byPart.set(originPart, id);
    this.assets.push({
      id,
      mediaType,
      originPart,
      bytes: bytes.slice(),
    });
    return id;
  }
}

/**
 * Resolve an image relationship to its source. Failures degrade to
 * `undefined`; fatal errors propagate.
 */
export function relImageSource(
  pkg: Package,
  rels: Relationships,
  basePart: string,
  assets: AssetSink,
  relId: string,
): ImageSource | undefined {
  const rel = rels.get(relId);
  if (rel === undefined) return undefined;
  if (rel.mode === 'external') {
    return rel.target.length > 0 ? { type: 'external', url: rel.target } : undefined;
  }
  const loaded = relTargetBytes(pkg, rels, basePart, relId);
  if (loaded === undefined) return undefined;
  const [part, bytes] = loaded;
  const id = assets.add(mediaTypeFor(part), part, bytes);
  return { type: 'asset', id };
}

/** MIME type from a part path's extension. */
export function mediaTypeFor(part: string): string {
  const dot = part.lastIndexOf('.');
  const ext = (dot >= 0 ? part.slice(dot + 1) : '').toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'bmp':
      return 'image/bmp';
    case 'tif':
    case 'tiff':
      return 'image/tiff';
    case 'svg':
      return 'image/svg+xml';
    case 'emf':
      return 'image/emf';
    case 'wmf':
      return 'image/wmf';
    case 'webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}
