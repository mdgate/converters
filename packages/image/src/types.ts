export type ImageMime = 'image/jpeg' | 'image/png' | 'image/webp';

export type ImageInput = {
  bytes: Uint8Array;
  mime: ImageMime;
  page?: number;
};

export type ConvertImage = (image: ImageInput) => Promise<string>;
