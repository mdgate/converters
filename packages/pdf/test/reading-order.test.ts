import { describe, expect, it } from 'vitest';
import { groupIntoLines, orderBoxes } from '../src/layout.js';

function word(
  text: string,
  x: number,
  y: number,
  width: number,
  extra?: { fontSize?: number; page?: number; dx?: number; dy?: number },
) {
  return {
    text,
    x,
    y,
    width,
    height: extra?.fontSize ?? 11,
    fontSize: extra?.fontSize ?? 11,
    page: extra?.page ?? 1,
    ...extra,
  };
}

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

  it('splits an 11pt gutter that is below the per-row gap threshold', () => {
    const lines = groupIntoLines([
      word('Left one', 20, 200, 120),
      word('Right one', 151, 200, 120),
      word('Left two', 20, 180, 120),
      word('Right two', 151, 180, 120),
      word('Left three', 20, 160, 120),
      word('Right three', 151, 160, 120),
    ]);
    const texts = lines.map((line) => line.map((t) => t.text).join(' '));
    expect(texts).toContain('Left one');
    expect(texts).toContain('Right one');
    expect(texts.some((t) => t.includes('Left one') && t.includes('Right one'))).toBe(false);
  });

  it('does not merge bibliography rows across a modest gutter', () => {
    const lines = groupIntoLines([
      word('25 Beckford, An Arabian Tale.', 20, 80, 118),
      word('31 Fortune in coffee grounds.', 151, 80, 118),
      word('26 Hattox, Coffee and Coffeehouses.', 20, 64, 118),
      word('33 Pharmacopoia Reformata.', 151, 64, 118),
    ]);
    const texts = lines.map((line) => line.map((t) => t.text).join(' '));
    expect(texts.some((t) => t.includes('Beckford') && t.includes('Fortune'))).toBe(false);
    expect(texts.filter((t) => t.includes('Beckford') || t.includes('Hattox'))).toHaveLength(2);
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

  it('keeps a short centered affiliation above both columns', () => {
    const ordered = orderBoxes([
      { x: 90, y: 160, x2: 170, y2: 148, id: 'AFF' },
      { x: 20, y: 120, x2: 100, y2: 108, id: 'L1' },
      { x: 20, y: 90, x2: 100, y2: 78, id: 'L2' },
      { x: 160, y: 120, x2: 240, y2: 108, id: 'R1' },
      { x: 160, y: 90, x2: 240, y2: 78, id: 'R2' },
    ]);
    expect(ordered.map((b) => b.id)).toEqual(['AFF', 'L1', 'L2', 'R1', 'R2']);
  });

  it('reads wrap text then the figure caption, not caption mid-sentence', () => {
    const ordered = orderBoxes([
      { x: 20, y: 200, x2: 240, y2: 186, id: 'T' },
      { x: 20, y: 170, x2: 110, y2: 158, id: 'L1' },
      { x: 20, y: 150, x2: 110, y2: 138, id: 'L2' },
      { x: 20, y: 130, x2: 110, y2: 118, id: 'L3' },
      { x: 130, y: 150, x2: 230, y2: 138, id: 'C1' },
      { x: 130, y: 130, x2: 230, y2: 118, id: 'C2' },
      { x: 20, y: 100, x2: 240, y2: 86, id: 'L4' },
    ]);
    const ids = ordered.map((b) => b.id);
    expect(ids.indexOf('L2')).toBeLessThan(ids.indexOf('C1'));
    expect(ids.indexOf('L3')).toBeLessThan(ids.indexOf('C1'));
    expect(ids.indexOf('C1')).toBeLessThan(ids.indexOf('C2'));
    expect(ids).not.toEqual(['T', 'L1', 'L2', 'C1', 'L3', 'C2', 'L4']);
  });

  it('reads wrap text then a one-line figure caption', () => {
    const ordered = orderBoxes([
      { x: 20, y: 200, x2: 240, y2: 186, id: 'T' },
      { x: 20, y: 170, x2: 110, y2: 158, id: 'L1' },
      { x: 20, y: 150, x2: 110, y2: 138, id: 'L2' },
      { x: 20, y: 130, x2: 110, y2: 118, id: 'L3' },
      { x: 130, y: 150, x2: 230, y2: 138, id: 'C1' },
      { x: 20, y: 100, x2: 240, y2: 86, id: 'L4' },
    ]);
    expect(ordered.map((b) => b.id)).toEqual(['T', 'L1', 'L2', 'L3', 'C1', 'L4']);
  });

  it('keeps a same-baseline label and continuation across a wide hole', () => {
    const ordered = orderBoxes([
      { x: 56, y: 280, x2: 160, y2: 268, id: 'ABOVE' },
      { x: 56, y: 250, x2: 105, y2: 238, id: 'LABEL' },
      { x: 258, y: 250, x2: 325, y2: 238, id: 'AFTER' },
      { x: 56, y: 230, x2: 157, y2: 218, id: 'NEXT' },
    ]);
    expect(ordered.map((b) => b.id)).toEqual(['ABOVE', 'LABEL', 'AFTER', 'NEXT']);
  });

  it('emits a shorter left column first when the right column starts higher', () => {
    const ordered = orderBoxes([
      { x: 20, y: 140, x2: 110, y2: 128, id: 'C' },
      { x: 20, y: 100, x2: 110, y2: 88, id: 'L1' },
      { x: 20, y: 70, x2: 110, y2: 58, id: 'L2' },
      { x: 160, y: 180, x2: 250, y2: 168, id: 'R1' },
      { x: 160, y: 150, x2: 250, y2: 138, id: 'R2' },
      { x: 160, y: 100, x2: 250, y2: 88, id: 'R3' },
    ]);
    expect(ordered.map((b) => b.id)).toEqual(['C', 'L1', 'L2', 'R1', 'R2', 'R3']);
  });

  it('reads three-column cards left to right, each top to bottom', () => {
    const ordered = orderBoxes([
      { x: 20, y: 120, x2: 90, y2: 108, id: 'A1' },
      { x: 20, y: 90, x2: 90, y2: 78, id: 'A2' },
      { x: 140, y: 120, x2: 210, y2: 108, id: 'B1' },
      { x: 140, y: 90, x2: 210, y2: 78, id: 'B2' },
      { x: 260, y: 120, x2: 330, y2: 108, id: 'C1' },
      { x: 260, y: 90, x2: 330, y2: 78, id: 'C2' },
    ]);
    expect(ordered.map((b) => b.id)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
  });

  it('keeps a zero-width margin header out of the column body', () => {
    const ordered = orderBoxes([
      { x: 32, y: 248, x2: 32, y2: 228, id: 'arxiv' },
      { x: 70, y: 600, x2: 270, y2: 588, id: 'L1' },
      { x: 70, y: 250, x2: 270, y2: 238, id: 'L2' },
      { x: 70, y: 80, x2: 270, y2: 68, id: 'L3' },
      { x: 310, y: 600, x2: 510, y2: 588, id: 'R1' },
      { x: 310, y: 250, x2: 510, y2: 238, id: 'R2' },
    ]);
    const ids = ordered.map((b) => b.id);
    expect(ids[0]).toBe('arxiv');
    expect(ids.indexOf('L1')).toBeLessThan(ids.indexOf('L2'));
    expect(ids.indexOf('L2')).toBeLessThan(ids.indexOf('R1'));
    expect(ids.indexOf('arxiv')).toBeLessThan(ids.indexOf('L2'));
  });

  it('does not peel a thin figure as a page footer', () => {
    const ordered = orderBoxes([
      { x: 70, y: 100, x2: 71, y2: 40, id: 'IMG' },
      { x: 310, y: 600, x2: 510, y2: 588, id: 'R1' },
      { x: 310, y: 400, x2: 510, y2: 388, id: 'R2' },
      { x: 310, y: 80, x2: 510, y2: 68, id: 'R3' },
    ]);
    const ids = ordered.map((b) => b.id);
    expect(ids[ids.length - 1]).not.toBe('IMG');
  });

  it('keeps a thin figure that extends past column text in column order', () => {
    const ordered = orderBoxes([
      { x: 70, y: 600, x2: 270, y2: 588, id: 'L1' },
      { x: 70, y: 250, x2: 270, y2: 238, id: 'L2' },
      { x: 67, y: 400, x2: 68, y2: 300, id: 'IMG' },
      { x: 310, y: 600, x2: 510, y2: 588, id: 'R1' },
      { x: 310, y: 250, x2: 510, y2: 238, id: 'R2' },
    ]);
    expect(ordered.map((b) => b.id)).toEqual(['L1', 'IMG', 'L2', 'R1', 'R2']);
  });
});
