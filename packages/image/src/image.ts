import type { ConvertImage, ImagePlugin } from './types.js';

/** Register an image-to-markdown function with `create([pdf(), image(fn)])`. */
export function image(convert: ConvertImage): ImagePlugin {
  return { kind: 'image', convert };
}
