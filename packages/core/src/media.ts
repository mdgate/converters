export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export type ImageInput = {
  bytes: Uint8Array;
  mime: ImageMime;
  /** 1-based page number when the image came from a paged document. */
  page?: number;
};

/** Convert an image the format converter cannot handle into markdown. */
export type ConvertImage = (image: ImageInput) => Promise<string>;
