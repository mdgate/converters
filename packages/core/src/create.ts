import type { Converter, ConvertHint, ConvertOptions } from './converter.js';
import { ConvertError } from './error.js';

/** A non-format plugin, e.g. `image()`. `create` puts `convert` on options[`kind`]. */
export type Capability = {
  readonly kind: string;
  readonly convert: (...args: never[]) => unknown;
};

export type Plugin = Converter | Capability;

/**
 * Compose registered plugins into one `convert` function.
 * Format converters compete by `sniff`; capabilities are passed through to the winner.
 */
export function create(
  plugins: readonly Plugin[],
): (bytes: Uint8Array, hint?: ConvertHint) => Promise<string> {
  const converters: Converter[] = [];
  const capabilities: Record<string, unknown> = {};
  for (const plugin of plugins) {
    if (isCapability(plugin)) {
      capabilities[plugin.kind] = plugin.convert;
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
      Object.keys(capabilities).length === 0 ? hint : { ...hint, ...capabilities };
    const result = await best.convert(bytes, convertOptions);
    return result.markdown;
  };
}

function isCapability(plugin: Plugin): plugin is Capability {
  return 'kind' in plugin && !('sniff' in plugin);
}
