import { describe, expect, it } from 'vitest';
import { groupIntoLines, orderBoxes, peelFootnoteLines } from '../src/layout.js';

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

  it('reads wrap text then a one-line caption when one wrap line is longer', () => {
    const ordered = orderBoxes([
      { x: 20, y: 200, x2: 240, y2: 186, id: 'T' },
      { x: 20, y: 170, x2: 110, y2: 158, id: 'L1' },
      { x: 20, y: 150, x2: 125, y2: 138, id: 'L2' },
      { x: 20, y: 130, x2: 110, y2: 118, id: 'L3' },
      { x: 130, y: 150, x2: 230, y2: 138, id: 'C1' },
      { x: 20, y: 100, x2: 240, y2: 86, id: 'L4' },
    ]);
    expect(ordered.map((b) => b.id)).toEqual(['T', 'L1', 'L2', 'L3', 'C1', 'L4']);
  });

  it('reads wrap text then a one-line caption seated farther under a figure', () => {
    const ordered = orderBoxes([
      { x: 20, y: 200, x2: 240, y2: 186, id: 'T' },
      { x: 20, y: 170, x2: 110, y2: 158, id: 'L1' },
      { x: 20, y: 150, x2: 110, y2: 138, id: 'L2' },
      { x: 20, y: 130, x2: 110, y2: 118, id: 'L3' },
      { x: 160, y: 150, x2: 230, y2: 138, id: 'C1' },
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

describe('peelFootnoteLines', () => {
  it('keeps two-column notes after both columns of body', () => {
    const lines = [
      [word('Left body one', 20, 200, 120)],
      [word('Left body two', 20, 180, 120)],
      [word('Right body one', 200, 200, 120)],
      [word('Right body two', 200, 180, 120)],
      [word('25 Left note one continues here.', 20, 50, 120, { fontSize: 8 })],
      [word('26 Left note two continues here.', 20, 35, 120, { fontSize: 8 })],
      [word('30 Right note one continues here.', 200, 50, 120, { fontSize: 8 })],
      [word('31 Right note two continues here.', 200, 35, 120, { fontSize: 8 })],
    ];
    const { body, notes, footer } = peelFootnoteLines(lines);
    expect(body.map((line) => line[0]!.text)).toEqual([
      'Left body one',
      'Left body two',
      'Right body one',
      'Right body two',
    ]);
    expect(notes.map((line) => line[0]!.text)).toEqual([
      '25 Left note one continues here.',
      '26 Left note two continues here.',
      '30 Right note one continues here.',
      '31 Right note two continues here.',
    ]);
    expect(footer).toHaveLength(0);
  });

  it('matches a bottom note to a body superscript and peels a page number', () => {
    const lines = [
      [word('from FY2019.⁴ The data collected after implementation', 20, 200, 300)],
      [word('of the FIT scheme revealed the costs.', 20, 180, 280)],
      [word('4 Biomass of waste is not eligible from FY2021.', 20, 40, 280, { fontSize: 9 })],
      [word('31', 300, 18, 12, { fontSize: 9 })],
    ];
    const { body, notes, footer } = peelFootnoteLines(lines);
    expect(body.map((line) => line[0]!.text)).toEqual([
      'from FY2019.⁴ The data collected after implementation',
      'of the FIT scheme revealed the costs.',
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0]![0]!.text).toContain('Biomass of waste');
    expect(footer.map((line) => line[0]!.text)).toEqual(['31']);
  });

  it('drops a stray marker line that already appears as a body superscript', () => {
    const lines = [
      [word('Coffee is called the wine of Islam.²⁶', 20, 200, 260)],
      [word('26', 80, 204, 8, { fontSize: 7 })],
      [word('Body continues after the marker.', 20, 180, 240)],
      [word('26 For the association between coffee and wine.', 20, 40, 240, { fontSize: 8 })],
    ];
    const { body, notes } = peelFootnoteLines(lines);
    expect(body.map((line) => line[0]!.text)).toEqual([
      'Coffee is called the wine of Islam.²⁶',
      'Body continues after the marker.',
    ]);
    expect(notes).toHaveLength(1);
    expect(notes[0]![0]!.text).toContain('For the association');
  });

  it('keeps a page number that matches a footnote number', () => {
    const lines = [
      [word('Body with a citation.¹ More text follows after that.', 20, 200, 300)],
      [word('1 The first note explains the method used here.', 20, 40, 280, { fontSize: 8 })],
      [word('1', 300, 18, 12, { fontSize: 9 })],
    ];
    const { body, notes, footer, drop } = peelFootnoteLines(lines);
    expect(body.map((line) => line[0]!.text)).toEqual([
      'Body with a citation.¹ More text follows after that.',
    ]);
    expect(notes).toHaveLength(1);
    expect(footer.map((line) => line[0]!.text)).toEqual(['1']);
    expect(drop).toHaveLength(0);
  });

  it('does not treat a numbered figure caption as a footnote', () => {
    const lines = [
      [word('The results appear below the fold on this page.', 20, 200, 280)],
      [word('1 Figure of the experimental setup on page two.', 20, 40, 280, { fontSize: 8 })],
    ];
    const { body, notes } = peelFootnoteLines(lines);
    expect(notes).toHaveLength(0);
    expect(body).toHaveLength(2);
  });

  it('does not peel a numbered list when the body has figure and version digits', () => {
    const lines = [
      [word('See Fig.1 and p.45 and v2 and 3.14 in the text.', 20, 200, 300)],
      [word('Body paragraph about the survey results here.', 20, 160, 260)],
      [word('1. First list item stays in the body.', 20, 40, 260)],
      [word('2. Second list item stays in the body.', 20, 24, 260)],
    ];
    const { body, notes } = peelFootnoteLines(lines);
    expect(notes).toHaveLength(0);
    expect(body).toHaveLength(4);
  });

  it('does not peel a top heading or a same-size numbered list', () => {
    const lines = [
      [word('1. Introduction to land ownership', 20, 200, 260)],
      [word('Body paragraph about the survey results.', 20, 160, 260)],
      [word('1. First list item stays in the body.', 20, 40, 260)],
      [word('2. Second list item stays in the body.', 20, 24, 260)],
    ];
    const { body, notes } = peelFootnoteLines(lines);
    expect(notes).toHaveLength(0);
    expect(body).toHaveLength(4);
  });
});
