export type AiImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export type AiImage = {
  bytes: Uint8Array;
  mime: AiImageMime;
  /** 1-based page number when the image came from a paged document. */
  page?: number;
};

/**
 * Optional vision capability injected at `create(..., { ai })`.
 * Implemented by `@mdgate/ai`; converters call `ai.readImage` when they need it.
 */
export interface Ai {
  readImage(image: AiImage): Promise<string>;
}
