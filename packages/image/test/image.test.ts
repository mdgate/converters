import { describe, expect, it } from 'vitest';
import { image } from '../src/index.js';

describe('image', () => {
  it('wraps a convert function as an image plugin', async () => {
    const convert = async () => 'ok';
    const plugin = image(convert);
    expect(plugin.kind).toBe('image');
    expect(plugin.convert).toBe(convert);
    await expect(plugin.convert({ bytes: new Uint8Array([1]), mime: 'image/png' })).resolves.toBe(
      'ok',
    );
  });
});
