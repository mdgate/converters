import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

test('published @mdgate packages share one version', () => {
  const result = spawnSync('bun', ['scripts/version.ts', '--check'], {
    encoding: 'utf8',
  });
  expect(result.status, result.stdout + result.stderr).toBe(0);
});
