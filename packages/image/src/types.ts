export type ImageMime =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/gif'
  | 'image/tiff'
  | 'image/heic'
  | 'image/bmp'
  | 'image/svg+xml';

export type ImageInput = {
  bytes: Uint8Array;
  mime: ImageMime;
  page?: number;
};

export type ConvertImage = (image: ImageInput) => Promise<string>;
