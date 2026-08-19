/**
 * Decide whether a main-branch commit should auto-publish a patch.
 *
 *   bun scripts/should-publish-patch.ts
 *
 * Writes publish=true|false and reason=... to GITHUB_OUTPUT when set.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './packages.ts';

export type PatchDecision = { publish: boolean; reason: string };

const MANUAL_LABELS = ['release:minor', 'release:major'] as const;

export function decidePatch(input: {
  commitMessage: string;
  labels: string[];
  changedFiles: string[];
  addedPublicPackages: string[];
}): PatchDecision {
  const message = input.commitMessage.trim();
  if (/^release:\s*\d+\.\d+\.\d+\s*$/m.test(message.split('\n')[0] ?? '')) {
    return { publish: false, reason: 'already a release commit' };
  }
  if (/\[skip publish\]/i.test(message) || /\bskip-publish\b/i.test(message)) {
    return { publish: false, reason: 'commit asked to skip publish' };
  }
  const manual = MANUAL_LABELS.find(
    (label) => input.labels.includes(label) || message.includes(label),
  );
  if (manual) {
    return { publish: false, reason: `${manual} set; run CI with that increment` };
  }
  if (input.addedPublicPackages.length > 0) {
    return {
      publish: false,
      reason: `new published package ${input.addedPublicPackages.join(', ')}; run CI with increment=minor`,
    };
  }
  if (!input.changedFiles.some((file) => file.startsWith('packages/'))) {
    return { publish: false, reason: 'no packages/ changes' };
  }
  return { publish: true, reason: 'packages/ changed' };
}

function git(args: string[]): { ok: boolean; stdout: string } {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return { ok: result.status === 0, stdout: (result.stdout ?? '').trim() };
}

function isPublicPackageJson(path: string): boolean {
  const json = JSON.parse(readFileSync(path, 'utf8')) as { name?: string; private?: boolean };
  return !json.private && typeof json.name === 'string' && json.name.startsWith('@mdgate/');
}

async function prLabels(sha: string): Promise<string[]> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) return [];
  const response = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/pulls`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) return [];
  const pulls = (await response.json()) as Array<{ labels?: Array<{ name?: string }> }>;
  return pulls.flatMap((pull) => (pull.labels ?? []).map((label) => label.name).filter(Boolean));
}

export async function inspectHead(): Promise<{
  commitMessage: string;
  labels: string[];
  changedFiles: string[];
  addedPublicPackages: string[];
}> {
  const sha = process.env.GITHUB_SHA || git(['rev-parse', 'HEAD']).stdout;
  const commitMessage = git(['log', '-1', '--pretty=%B']).stdout;
  const diff = git(['diff', '--name-only', 'HEAD~1', 'HEAD']);
  if (!diff.ok) {
    return { commitMessage, labels: [], changedFiles: [], addedPublicPackages: [] };
  }
  const changedFiles = diff.stdout === '' ? [] : diff.stdout.split('\n');
  const added = git(['diff', '--diff-filter=A', '--name-only', 'HEAD~1', 'HEAD', '--', 'packages']);
  const addedPublicPackages = (added.ok ? added.stdout.split('\n') : []).filter((file) => {
    if (!/^packages\/[^/]+\/package\.json$/.test(file)) return false;
    return isPublicPackageJson(join(ROOT, file));
  });
  const labels = await prLabels(sha);
  return { commitMessage, labels, changedFiles, addedPublicPackages };
}

function writeOutput(decision: PatchDecision): void {
  console.log(decision.reason);
  if (!decision.publish && process.env.GITHUB_ACTIONS === 'true') {
    console.log(`::warning::${decision.reason}`);
  }
  const out = process.env.GITHUB_OUTPUT;
  if (out) {
    appendFileSync(out, `publish=${decision.publish}\nreason=${decision.reason}\n`);
  }
}

export async function main(): Promise<number> {
  const inspected = await inspectHead();
  const decision = decidePatch(inspected);
  writeOutput(decision);
  return 0;
}

if (import.meta.main) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
