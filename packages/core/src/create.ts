import type { Converter, ConvertHint, ConvertOptions } from './converter.js';
import { ConvertError } from './error.js';
import type { ConvertImage } from './media.js';

export type CreateOptions = {
  image?: ConvertImage;
};

/**
 * Compose registered converters into one `convert` function.
 * Highest `sniff` score wins; ties keep the first registered converter.
 */
export function create(
  converters: readonly Converter[],
  options?: CreateOptions,
): (bytes: Uint8Array, hint?: ConvertHint) => Promise<string> {
  return async (bytes, hint) => {
    if (!(bytes instanceof Uint8Array)) {
      throw ConvertError.unsupported('input must be a Uint8Array');
    }

    let best: Converter | undefined;
    let bestScore = 0;
    for (const converter of converters) {
      const score = converter.sniff(bytes, hint);
      if (score > bestScore) {
        bestScore = score;
        best = converter;
      }
    }

    if (best === undefined || bestScore <= 0) {
      throw ConvertError.unsupported(
        hint?.path === undefined
          ? 'unrecognized file content: name the format explicitly'
          : `unrecognized file content and extension: ${hint.path}`,
      );
    }

    const convertOptions: ConvertOptions | undefined =
      options?.image === undefined ? hint : { ...hint, image: options.image };
    const result = await best.convert(bytes, convertOptions);
    return result.markdown;
  };
}
