import { describe, expect, it } from 'vitest';
import { fromStyleName } from '../src/blockstyle.js';
import { hyperlinkTarget } from '../src/fields.js';
import { compositeLabel, parsePercentPattern } from '../src/numbering.js';

describe('common helpers', () => {
  it('maps style names', () => {
    expect(fromStyleName('Intense Quote')).toBe('quote');
    expect(fromStyleName('Preformatted_20_Text')).toBe('code');
    expect(fromStyleName('Normal')).toBeUndefined();
  });

  it('parses percent patterns and composite labels', () => {
    expect(parsePercentPattern('%1.%2)')).toEqual([
      { type: 'level', level: 0 },
      { type: 'literal', text: '.' },
      { type: 'level', level: 1 },
      { type: 'literal', text: ')' },
    ]);
    const label = compositeLabel(
      { text: parsePercentPattern('%1-%2)'), legal: false },
      'lowerAlpha',
      5,
      (l) => (l === 0 ? 'decimal' : 'lowerAlpha'),
      (l) => [2, 5][Math.min(l, 1)]!,
    );
    expect(label).toBe('2-e)');
  });

  it('classifies hyperlink fields', () => {
    expect(hyperlinkTarget(' HYPERLINK "https://e.com/a b" ')).toEqual({
      type: 'external',
      url: 'https://e.com/a b',
    });
    expect(hyperlinkTarget('HYPERLINK \\l "sec2"')).toEqual({ type: 'anchor', id: 'sec2' });
  });
});
