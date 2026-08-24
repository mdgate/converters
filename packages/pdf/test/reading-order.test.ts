import { describe, expect, it } from 'vitest';
import { groupIntoLines, orderBoxes } from '../src/layout.js';

describe('groupIntoLines', () => {
  it('splits a shared baseline at a column gutter', () => {
    const lines = groupIntoLines([
      { text: 'Alpha', x: 20, y: 90, width: 30, height: 12, fontSize: 12, page: 1 },
      { text: 'Charlie', x: 160, y: 90, width: 40, height: 12, fontSize: 12, page: 1 },
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.map((t) => t.text)).toEqual(['Alpha']);
    expect(lines[1]!.map((t) => t.text)).toEqual(['Charlie']);
  });

  it('keeps words on one line when the gap is a space', () => {
    const lines = groupIntoLines([
      { text: 'Hello', x: 20, y: 50, width: 30, height: 12, fontSize: 12, page: 1 },
      { text: 'World', x: 54, y: 50, width: 32, height: 12, fontSize: 12, page: 1 },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.map((t) => t.text)).toEqual(['Hello', 'World']);
  });
});

describe('orderBoxes', () => {
  it('emits left column then right column for overlapping y-ranges', () => {
    const ordered = orderBoxes([
      { x: 20, y: 110, x2: 90, y2: 98, id: 'L1' },
      { x: 20, y: 80, x2: 90, y2: 68, id: 'L2' },
      { x: 160, y: 110, x2: 230, y2: 98, id: 'R1' },
      { x: 160, y: 80, x2: 230, y2: 68, id: 'R2' },
    ]);
    expect(ordered.map((b) => b.id)).toEqual(['L1', 'L2', 'R1', 'R2']);
  });

  it('keeps a spanning title above both columns', () => {
    const ordered = orderBoxes([
      { x: 20, y: 140, x2: 240, y2: 126, id: 'T' },
      { x: 20, y: 100, x2: 90, y2: 88, id: 'L1' },
      { x: 20, y: 70, x2: 90, y2: 58, id: 'L2' },
      { x: 160, y: 100, x2: 230, y2: 88, id: 'R1' },
      { x: 160, y: 70, x2: 230, y2: 58, id: 'R2' },
    ]);
    expect(ordered.map((b) => b.id)).toEqual(['T', 'L1', 'L2', 'R1', 'R2']);
  });
});
