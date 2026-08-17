import type { Converter, ConvertHint, ConvertOptions } from './converter.js';
import { ConvertError } from './error.js';
import type { ImagePlugin } from './media.js';

export type Plugin = Converter | ImagePlugin;

/**
 * Compose registered plugins into one `convert` function.
 * Format converters compete by `sniff`; `image()` is handed to the winner.
 */
export function create(
  plugins: readonly Plugin[],
): (bytes: Uint8Array, hint?: ConvertHint) => Promise<string> {
  const converters: Converter[] = [];
  let image: ImagePlugin['convert'] | undefined;
  for (const plugin of plugins) {
    if (isImagePlugin(plugin)) {
      image = plugin.convert;
      continue;
    }
    converters.push(plugin);
  }

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
      image === undefined ? hint : { ...hint, image };
    const result = await best.convert(bytes, convertOptions);
    return result.markdown;
  };
}

function isImagePlugin(plugin: Plugin): plugin is ImagePlugin {
  return (plugin as ImagePlugin).kind === 'image';
}
