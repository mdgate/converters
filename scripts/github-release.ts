/**
 * Create or update the GitHub Release for the shared published version.
 *
 *   bun scripts/github-release.ts
 *   bun scripts/github-release.ts --dry-run
 */
import { spawnSync } from 'node:child_process';
import { loadPublished, ROOT } from './packages.ts';
import { isExact, sharedVersion } from './version.ts';

export type GeneratedNotes = { name: string; body: string };

const SECTIONS = ['Features', 'Fixes', 'Documentation', 'Other Changes'] as const;
type Section = (typeof SECTIONS)[number];

export function repoFromRemote(url: string): string | undefined {
  const trimmed = url.trim().replace(/\.git$/, '');
  const match = trimmed.match(/github\.com[:/](.+\/[^/]+)$/);
  return match?.[1];
}

export function sectionFor(item: string): Section {
  const text = item.replace(/^[-*]\s*/, '');
  if (/^feat(\(|:|!)/i.test(text)) return 'Features';
  if (/^fix(\(|:|!)/i.test(text)) return 'Fixes';
  if (/^docs(\(|:)/i.test(text)) return 'Documentation';
  return 'Other Changes';
}

export function formatReleaseNotes(generated: string): string {
  const lines = generated.replace(/\r\n/g, '\n').split('\n');
  const items = lines.map((line) => line.trim()).filter((line) => /^[-*]\s+\S/.test(line));
  const changelog = lines
    .map((line) => line.trim())
    .find((line) => /Full Changelog/i.test(line) && /https?:\/\//.test(line));

  const groups = new Map<Section, string[]>(SECTIONS.map((section) => [section, []]));
  for (const item of items) {
    groups.get(sectionFor(item))!.push(`- ${item.replace(/^[-*]\s+/, '')}`);
  }

  const parts: string[] = [];
  for (const section of SECTIONS) {
    const entries = groups.get(section)!;
    if (entries.length === 0) continue;
    parts.push(`### ${section}`, '', ...entries, '');
  }

  if (parts.length === 0) {
    parts.push('No merged pull requests in this range.', '');
  }
  if (changelog) {
    const url = changelog.match(/https?:\/\/\S+/)?.[0];
    parts.push(url ? `**Full Changelog**: ${url}` : changelog);
  }
  return `${parts.join('\n').trim()}\n`;
}

export function releasePayload(
  version: string,
  notes: GeneratedNotes,
): { tag_name: string; name: string; body: string; make_latest: 'true' } {
  return {
    tag_name: `v${version}`,
    name: notes.name || `v${version}`,
    body: notes.body,
    make_latest: 'true',
  };
}

function git(args: string[]): { ok: boolean; stdout: string } {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return { ok: result.status === 0, stdout: (result.stdout ?? '').trim() };
}

export function resolveRepo(): string | undefined {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const remote = git(['remote', 'get-url', 'origin']);
  if (!remote.ok) return undefined;
  return repoFromRemote(remote.stdout);
}

function resolveToken(): string | undefined {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
}

async function github(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json: unknown;
  if (text !== '') {
    try {
      json = JSON.parse(text);
    } catch {
      json = { message: text };
    }
  }
  return { status: response.status, json };
}

export async function generateNotes(
  token: string,
  repo: string,
  tag: string,
): Promise<GeneratedNotes> {
  const result = await github(token, 'POST', `/repos/${repo}/releases/generate-notes`, {
    tag_name: tag,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`generate-notes ${tag}: HTTP ${result.status}`);
  }
  const notes = result.json as GeneratedNotes;
  return {
    name: notes.name || tag,
    body: formatReleaseNotes(notes.body ?? ''),
  };
}

export async function publishGitHubRelease(
  token: string,
  repo: string,
  version: string,
  notes: GeneratedNotes,
): Promise<'created' | 'updated'> {
  const payload = releasePayload(version, notes);
  const existing = await github(token, 'GET', `/repos/${repo}/releases/tags/${payload.tag_name}`);
  if (existing.status === 200) {
    const id = (existing.json as { id: number }).id;
    const patched = await github(token, 'PATCH', `/repos/${repo}/releases/${id}`, payload);
    if (patched.status < 200 || patched.status >= 300) {
      throw new Error(`update ${payload.tag_name}: HTTP ${patched.status}`);
    }
    return 'updated';
  }
  const created = await github(token, 'POST', `/repos/${repo}/releases`, payload);
  if (created.status < 200 || created.status >= 300) {
    throw new Error(`create ${payload.tag_name}: HTTP ${created.status}`);
  }
  return 'created';
}

function parseArgs(argv: string[]): { dryRun: boolean } {
  let dryRun = false;
  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    throw new Error(`unknown argument ${arg}`);
  }
  return { dryRun };
}

export async function main(argv: string[]): Promise<number> {
  let dryRun = false;
  try {
    dryRun = parseArgs(argv).dryRun;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error('usage: bun scripts/github-release.ts [--dry-run]');
    return 2;
  }

  const pkgs = loadPublished();
  let version: string;
  try {
    version = sharedVersion(pkgs);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
  if (!isExact(version)) {
    console.error(`release notes require x.y.z, got ${version}`);
    return 1;
  }

  const repo = resolveRepo();
  const token = resolveToken();
  if (!repo || !token) {
    console.error('skip GitHub Release: GITHUB_REPOSITORY or GITHUB_TOKEN missing');
    return 0;
  }

  const tag = `v${version}`;
  const notes = await generateNotes(token, repo, tag);
  if (dryRun) {
    process.stdout.write(`# ${notes.name}\n\n${notes.body}`);
    return 0;
  }

  const action = await publishGitHubRelease(token, repo, version, notes);
  console.log(`${action} ${tag}`);
  return 0;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
