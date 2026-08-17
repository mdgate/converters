export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export type ImageInput = {
  bytes: Uint8Array;
  mime: ImageMime;
  /** 1-based page number when the image came from a paged document. */
  page?: number;
};

/** Convert an image the format converter cannot handle into markdown. */
export type ConvertImage = (image: ImageInput) => Promise<string>;

export type ImagePlugin = {
  readonly kind: 'image';
  readonly convert: ConvertImage;
};

/** Register an image-to-markdown function with `create([pdf(), image(fn)])`. */
export function image(convert: ConvertImage): ImagePlugin {
  return { kind: 'image', convert };
}
