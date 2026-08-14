/**
 * Shared helpers for the transplanted anydoc fixture corpus.
 * Fixtures and insta snapshots live next to this file.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toMarkdown } from '@mdgate/converters';

export const TEST_ROOT = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_ROOT = join(TEST_ROOT, 'fixtures');
export const SNAPSHOT_ROOT = join(TEST_ROOT, 'snapshots');

export type Outcome = 'recovers' | 'skips' | 'ignores' | 'errors';

export function walkFiles(dir: string, out: string[]): void {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(path, out);
    } else if (entry.isFile()) {
      out.push(path);
    }
  }
}

export function listFixtures(): string[] {
  const files: string[] = [];
  walkFiles(FIXTURE_ROOT, files);
  return files;
}

export function fixtureRel(path: string): string {
  return relative(FIXTURE_ROOT, path).replace(/\\/g, '/');
}

export function parseInstaSnapshot(raw: string): string {
  const text = raw.replace(/\r\n/g, '\n');
  if (!text.startsWith('---')) {
    return text;
  }
  const afterOpen = text.startsWith('---\n') ? text.slice(4) : text.slice(3);
  const close = afterOpen.indexOf('\n---\n');
  if (close === -1) {
    return text;
  }
  return afterOpen.slice(close + 5);
}

export function snapshotPathFor(rel: string): string {
  const name = rel.replace(/\\/g, '/').replaceAll('/', '__');
  return join(SNAPSHOT_ROOT, `snapshots__${name}.snap`);
}

export function readSnapshot(rel: string): string | undefined {
  const snapFile = snapshotPathFor(rel);
  if (!existsSync(snapFile)) return undefined;
  return parseInstaSnapshot(readFileSync(snapFile, 'utf8'));
}

export async function convertOrError(path: string): Promise<string> {
  try {
    return await toMarkdown(readFileSync(path), { path });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `ERROR: ${message}`;
  }
}

export function expectedOutcome(path: string): Outcome | undefined {
  const stem = basename(path).replace(/\.[^./]+$/, '');
  const split = stem.lastIndexOf('--');
  if (split === -1) return undefined;
  const outcome = stem.slice(split + 2);
  if (
    outcome === 'recovers' ||
    outcome === 'skips' ||
    outcome === 'ignores' ||
    outcome === 'errors'
  ) {
    return outcome;
  }
  return undefined;
}

export function isErrorOutput(output: string): boolean {
  return output.startsWith('ERROR: ') || output === 'PANIC';
}

/** Insta snap files are POSIX text, so a file-ending newline may not be in the string. */
export function snapshotMatches(actual: string, expected: string): boolean {
  if (actual === expected) return true;
  if (expected.endsWith('\n') && actual === expected.slice(0, -1)) return true;
  if (actual.endsWith('\n') && expected === actual.slice(0, -1)) return true;
  return false;
}

export function annotationDetail(outcome: Outcome, output: string): string | undefined {
  const erred = isErrorOutput(output);
  if (outcome === 'errors') {
    return erred ? undefined : 'annotated errors but converted successfully';
  }
  return erred ? `annotated ${outcome} but failed: ${oneLine(output, 120)}` : undefined;
}

export function oneLine(s: string, max: number): string {
  const line = s.replace(/\s+/g, ' ').trim();
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}
