import type { Converter } from '@mdgate/core';
import { office } from '@mdgate/office';
import { pdf } from '@mdgate/pdf';

export function all(): Converter[] {
  return [office(), pdf()];
}
