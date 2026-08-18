import type { Convert, Converter, ConvertHint, ConvertOptions } from './converter.js';
import { ConvertError } from './error.js';

/** Nested convert hops: zip → eml → docx. */
const MAX_DEPTH = 3;

export function create(converters: readonly Converter[]): Convert {
  const run = async (
    bytes: Uint8Array,
    hint: ConvertHint | undefined,
    depth: number,
  ): Promise<string> => {
    if (depth > MAX_DEPTH) {
      throw ConvertError.resourceLimit(
        'max_convert_depth',
        `nested conversion exceeds ${MAX_DEPTH} hops`,
      );
    }
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

    const options: ConvertOptions = {
      ...hint,
      convert: (inner, innerHint) => run(inner, innerHint, depth + 1),
    };
    const result = await best.convert(bytes, options);
    return result.markdown;
  };

  return (bytes, hint) => run(bytes, hint, 0);
}
