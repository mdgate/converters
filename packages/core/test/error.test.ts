import { describe, expect, it } from 'vitest';
import { ConvertError } from '../src/index.js';

describe('ConvertError codes', () => {
  it('names every variant', () => {
    expect(ConvertError.unsupported('').code).toBe('unsupported');
    expect(ConvertError.malformed('').code).toBe('malformed');
    expect(ConvertError.malformedPart('word/document.xml', '').code).toBe('malformed');
    expect(ConvertError.encrypted().code).toBe('encrypted');
    expect(ConvertError.resourceLimit('max_entry_bytes', '').code).toBe('resourceLimit');
    expect(ConvertError.missingPart('').code).toBe('missingPart');
    expect(ConvertError.io(new Error('nope')).code).toBe('io');
    expect(ConvertError.ai('no model').code).toBe('ai');
  });
});
