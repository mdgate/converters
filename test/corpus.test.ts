import { readFileSync } from 'node:fs';
import { detectOleDoc, detectZipDoc } from '@mdgate/containers';
import { asciiStartsWith } from '@mdgate/utils';
import { describe, expect, it } from 'vitest';
import { hasPdfMagic } from '../packages/pdf/src/sniff.js';
import {
  annotationDetail,
  convertOrError,
  expectedOutcome,
  fixtureRel,
  listFixtures,
  readSnapshot,
  snapshotMatches,
} from './corpus.js';

const DETECT_FOLDERS: Record<string, string | undefined> = {
  doc: 'doc',
  docx: 'docx',
  epub: 'epub',
  odp: 'odp',
  ods: 'ods',
  odt: 'odt',
  pdf: 'pdf',
  ppt: 'ppt',
  pptx: 'pptx',
  rtf: 'rtf',
  xls: 'xls',
  xlsx: 'xlsx',
  csv: undefined,
};

function detect(bytes: Uint8Array): string | undefined {
  if (asciiStartsWith(bytes, '{\\rtf')) return 'rtf';
  return detectOleDoc(bytes) ?? detectZipDoc(bytes) ?? (hasPdfMagic(bytes) ? 'pdf' : undefined);
}

const all = listFixtures();
const corpus = all.filter((path) => !fixtureRel(path).startsWith('abuse/'));
const abuse = all.filter((path) => fixtureRel(path).startsWith('abuse/'));

describe('anydoc fixture corpus', () => {
  it('has 66 fixtures and 58 non-abuse snapshots', () => {
    expect(all).toHaveLength(66);
    expect(corpus).toHaveLength(58);
    expect(abuse).toHaveLength(8);
  });

  for (const path of corpus) {
    const rel = fixtureRel(path);
    it(`matches snapshot: ${rel}`, async () => {
      const actual = await convertOrError(path);
      const outcome = expectedOutcome(path);
      if (outcome) {
        expect(annotationDetail(outcome, actual), `${rel} annotation`).toBeUndefined();
      }
      const expected = readSnapshot(rel);
      expect(expected, `${rel} missing snapshot`).toBeDefined();
      expect(snapshotMatches(actual, expected!), `${rel} snapshot mismatch`).toBe(true);
    });
  }
});

describe('fixture detection from bytes', () => {
  for (const [folder, format] of Object.entries(DETECT_FOLDERS)) {
    const files = all.filter((path) => fixtureRel(path).startsWith(`${folder}/`));
    it(`${folder}/ → ${format ?? 'undefined'}`, () => {
      expect(files.length, `no fixtures under ${folder}/`).toBeGreaterThan(0);
      for (const path of files) {
        const bytes = readFileSync(path);
        expect(detect(bytes), fixtureRel(path)).toBe(format);
      }
    });
  }
});
