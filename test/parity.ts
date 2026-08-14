/**
 * Fixture-corpus parity harness.
 *
 * Walks every file under test/fixtures except abuse/, converts with
 * toMarkdown, and compares against the corresponding insta snapshot
 * (ERROR: {message} on failure).
 */
import { relative } from 'node:path';
import {
  annotationDetail,
  convertOrError,
  expectedOutcome,
  FIXTURE_ROOT,
  listFixtures,
  readSnapshot,
  snapshotMatches,
} from './corpus.js';

type Status = 'PASS' | 'FAIL' | 'SKIP';

interface Row {
  rel: string;
  status: Status;
  detail: string;
  actual: string;
  expected: string | undefined;
}

function unifiedDiff(expected: string, actual: string, maxLines: number): string {
  const a = expected.split('\n');
  const b = actual.split('\n');
  const lines: string[] = ['--- expected', '+++ actual'];
  const n = Math.max(a.length, b.length);
  let shown = 0;
  for (let i = 0; i < n && shown < maxLines; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === right) continue;
    if (left !== undefined) {
      lines.push(`-${left}`);
      shown += 1;
    }
    if (right !== undefined && shown < maxLines) {
      lines.push(`+${right}`);
      shown += 1;
    }
  }
  if (n > 0 && shown === 0) {
    lines.push('(strings differ only by trailing newline / length)');
    lines.push(`expected ${expected.length} chars, actual ${actual.length} chars`);
  } else if (shown >= maxLines) {
    lines.push(`… truncated after ${maxLines} changed lines`);
  }
  return lines.join('\n');
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

async function run(): Promise<{
  passed: number;
  failed: number;
  skipped: number;
  report: string;
  rows: Row[];
}> {
  const files = listFixtures();
  const rows: Row[] = [];

  for (const path of files) {
    const rel = relative(FIXTURE_ROOT, path).replace(/\\/g, '/');
    if (rel === 'abuse' || rel.startsWith('abuse/')) continue;

    const actual = await convertOrError(path);
    const outcome = expectedOutcome(path);
    const expected = readSnapshot(rel);

    const notes: string[] = [];
    if (outcome) {
      const ann = annotationDetail(outcome, actual);
      if (ann) notes.push(ann);
    }

    if (expected === undefined) {
      rows.push({
        rel,
        status: notes.length > 0 ? 'FAIL' : 'SKIP',
        detail: notes.length > 0 ? notes.join('; ') : 'no snapshot',
        actual,
        expected,
      });
      continue;
    }

    if (!snapshotMatches(actual, expected)) {
      notes.push(
        `snapshot mismatch (expected ${expected.length} chars, actual ${actual.length} chars)`,
      );
    }

    rows.push({
      rel,
      status: notes.length > 0 ? 'FAIL' : 'PASS',
      detail: notes.join('; '),
      actual,
      expected,
    });
  }

  const passed = rows.filter((r) => r.status === 'PASS').length;
  const failed = rows.filter((r) => r.status === 'FAIL').length;
  const skipped = rows.filter((r) => r.status === 'SKIP').length;

  const nameWidth = Math.min(56, Math.max(12, ...rows.map((r) => r.rel.length)));
  const tableLines = [
    `${pad('fixture', nameWidth)}  ${pad('status', 6)}  detail`,
    `${'-'.repeat(nameWidth)}  ${'-'.repeat(6)}  ${'-'.repeat(40)}`,
  ];
  for (const row of rows) {
    tableLines.push(`${pad(row.rel, nameWidth)}  ${pad(row.status, 6)}  ${row.detail}`);
  }
  tableLines.push('');
  tableLines.push(`passed=${passed}  failed=${failed}  skipped=${skipped}  total=${rows.length}`);
  console.log(tableLines.join('\n'));

  const failRows = rows.filter((r) => r.status === 'FAIL');
  const diffBudget = 5;
  const reportParts: string[] = [
    `# fixture corpus parity`,
    '',
    `Converted ${rows.length} fixtures under \`test/fixtures\` (excluding \`abuse/\`).`,
    `Compared each result to the insta snapshot in \`test/snapshots/\`.`,
    '',
    `**Totals:** passed=${passed}  failed=${failed}  skipped=${skipped}`,
    '',
    '## Per-fixture',
    '',
    '| Fixture | Status | Detail |',
    '| --- | --- | --- |',
  ];
  for (const row of rows) {
    const detail = row.detail.replace(/\|/g, '\\|');
    reportParts.push(`| \`${row.rel}\` | ${row.status} | ${detail} |`);
  }

  if (failRows.length > 0) {
    reportParts.push('', '## Representative diffs', '');
    for (const row of failRows.slice(0, diffBudget)) {
      reportParts.push(`### \`${row.rel}\``, '');
      if (row.expected === undefined) {
        reportParts.push(row.detail || 'no expected snapshot', '');
        continue;
      }
      reportParts.push('```diff');
      reportParts.push(unifiedDiff(row.expected, row.actual, 24));
      reportParts.push('```', '');
    }
    if (failRows.length > diffBudget) {
      reportParts.push(`_(${failRows.length - diffBudget} additional failures not shown.)_`, '');
    }
  }

  return { passed, failed, skipped, report: reportParts.join('\n'), rows };
}

export { run };

const result = await run();
process.exitCode = result.failed > 0 ? 1 : 0;
