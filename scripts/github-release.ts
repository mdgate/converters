/**
 * Create or update the GitHub Release for the shared published version.
 *
 * Builds notes from commits since the previous tag (Next.js style), not
 * GitHub generate-notes.
 *
 *   bun scripts/github-release.ts
 *   bun scripts/github-release.ts --dry-run
 */
import { spawnSync } from 'node:child_process';
import { loadPublished, ROOT } from './packages.ts';
import { isExact, sharedVersion } from './version.ts';

export type GeneratedNotes = { name: string; body: string };

export type ReleaseCommit = { hash: string; title: string };

export type PullRequest = {
  title: string;
  number: number;
  labels: Array<{ name: string }>;
  user?: { login?: string } | null;
};

export const SECTIONS = [
  'Core Changes',
  'Documentation Changes',
  'Demo Changes',
  'Misc Changes',
] as const;
export type Section = (typeof SECTIONS)[number];

const PR_NUMBER = /\(#(\d+)\)$/;

const SECTION_LABELS: Array<{ section: Section; match: (name: string) => boolean }> = [
  {
    section: 'Core Changes',
    match: (name) => name === 'enhancement' || name === 'bug' || name.startsWith('pkg:'),
  },
  {
    section: 'Documentation Changes',
    match: (name) => name === 'documentation' || name === 'docs',
  },
  { section: 'Demo Changes', match: (name) => name === 'demo' },
];

export function repoFromRemote(url: string): string | undefined {
  const trimmed = url.trim().replace(/\.git$/, '');
  const match = trimmed.match(/github\.com[:/](.+\/[^/]+)$/);
  return match?.[1];
}

export function compareExact(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const delta = (left[i] ?? 0) - (right[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export function previousTagFrom(tags: string[], version: string): string | undefined {
  return tags
    .map((tag) => ({ tag, version: tag.replace(/^v/, '') }))
    .filter((entry) => isExact(entry.version) && compareExact(entry.version, version) < 0)
    .sort((a, b) => compareExact(b.version, a.version))[0]?.tag;
}

export function isReleaseTitle(title: string): boolean {
  const text = title.trim();
  if (/^release:\s*\d+\.\d+\.\d+\s*$/.test(text)) return true;
  return isExact(text.replace(/^v/, ''));
}

export function parseGitLog(stdout: string): ReleaseCommit[] {
  if (stdout === '') return [];
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const sep = line.indexOf('\x1f');
      if (sep === -1) return { hash: '', title: line };
      return { hash: line.slice(0, sep), title: line.slice(sep + 1) };
    });
}

export function getPullRequestNumber(title: string): number | undefined {
  const match = PR_NUMBER.exec(title.trim());
  if (!match) return undefined;
  const number = Number(match[1]);
  return Number.isInteger(number) ? number : undefined;
}

export function cleanupTitle(title: string): string {
  return title.trim().replace(/\s*\(#\d+\)$/, '');
}

export function isBotLogin(login: string | undefined): boolean {
  return !login || login.includes('[bot]');
}

export function sectionFor(input: { title: string; labels: string[] }): Section {
  for (const { section, match } of SECTION_LABELS) {
    if (input.labels.some(match)) return section;
  }
  const title = cleanupTitle(input.title);
  if (/^(feat|fix)(\(|:|!)/i.test(title)) return 'Core Changes';
  if (/^docs(\(|:)/i.test(title)) return 'Documentation Changes';
  return 'Misc Changes';
}

export function buildCredits(authors: Iterable<string>): string {
  const names = [...authors];
  if (names.length === 0) return '';
  const mentions = names.map((login) => `@${login}`);
  let list = mentions[0]!;
  if (mentions.length === 2) list = `${mentions[0]} and ${mentions[1]}`;
  if (mentions.length > 2) {
    list = `${mentions.slice(0, -1).join(', ')}, and ${mentions.at(-1)}`;
  }
  return `### Credits\n\nHuge thanks to ${list} for helping!\n`;
}

export type ChangelogEntry = { title: string; number?: number };

export function buildChangelog(
  groups: Map<Section, ChangelogEntry[]>,
  authors: Iterable<string>,
): string {
  const lines: string[] = [];
  for (const section of SECTIONS) {
    const entries = groups.get(section) ?? [];
    if (entries.length === 0) continue;
    if (lines.length > 0) lines.push('');
    lines.push(`### ${section}`, '');
    for (const entry of entries) {
      const number = entry.number != null ? `: #${entry.number}` : '';
      lines.push(`- ${entry.title}${number}`);
    }
  }
  const credits = buildCredits(authors).trimEnd();
  if (credits) {
    if (lines.length > 0) lines.push('');
    lines.push(...credits.split('\n'));
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

export async function generateChangelog(options: {
  commits: Array<{ title: string }>;
  getPullRequest: (number: number) => Promise<PullRequest | null>;
}): Promise<string> {
  const groups = new Map<Section, ChangelogEntry[]>(SECTIONS.map((section) => [section, []]));
  const authors = new Set<string>();

  for (const commit of options.commits) {
    if (isReleaseTitle(commit.title)) continue;
    const number = getPullRequestNumber(commit.title);
    const pull = number != null ? await options.getPullRequest(number) : null;
    const title = pull ? pull.title : cleanupTitle(commit.title);
    const labels = pull ? pull.labels.map((label) => label.name) : [];
    const entryNumber = pull?.number ?? number;
    groups.get(sectionFor({ title, labels }))!.push({
      title: cleanupTitle(title),
      number: entryNumber,
    });
    const login = pull?.user?.login;
    if (login && !isBotLogin(login)) authors.add(login);
  }

  return buildChangelog(groups, authors);
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

function git(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

function gitOrThrow(args: string[]): string {
  const result = git(args);
  if (!result.ok) {
    throw new Error(`git ${args.join(' ')}${result.stderr ? `: ${result.stderr}` : ''}`);
  }
  return result.stdout;
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

function mergedTags(sha: string): string[] {
  const listed = git(['tag', '--merged', sha, 'v*']);
  if (!listed.ok || listed.stdout === '') return [];
  return listed.stdout
    .split('\n')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function releaseCommits(fromTag: string | undefined, toSha: string): ReleaseCommit[] {
  const range = fromTag ? `${fromTag}..${toSha}` : toSha;
  const log = gitOrThrow(['log', '--no-merges', '--format=%H%x1f%s', range]);
  return parseGitLog(log).filter((commit) => !isReleaseTitle(commit.title));
}

async function fetchPullRequest(
  token: string,
  repo: string,
  number: number,
): Promise<PullRequest | null> {
  const result = await github(token, 'GET', `/repos/${repo}/pulls/${number}`);
  if (result.status < 200 || result.status >= 300) return null;
  const json = result.json as {
    title?: string;
    number?: number;
    labels?: Array<{ name?: string }>;
    user?: { login?: string } | null;
  };
  if (typeof json.title !== 'string' || typeof json.number !== 'number') return null;
  return {
    title: json.title,
    number: json.number,
    labels: (json.labels ?? []).flatMap((label) =>
      typeof label.name === 'string' ? [{ name: label.name }] : [],
    ),
    user: json.user,
  };
}

export async function generateNotes(
  token: string,
  repo: string,
  version: string,
): Promise<GeneratedNotes> {
  const tag = `v${version}`;
  const sha = gitOrThrow(['rev-list', '-n', '1', tag]);
  let tags = mergedTags(sha);
  if (previousTagFrom(tags, version) === undefined) {
    git(['fetch', '--tags', '--force', 'origin']);
    tags = mergedTags(sha);
  }
  const previous = previousTagFrom(tags, version);
  const commits = releaseCommits(previous, sha);
  const body = await generateChangelog({
    commits,
    getPullRequest: (number) => fetchPullRequest(token, repo, number),
  });
  return { name: tag, body };
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
  const notes = await generateNotes(token, repo, version);
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
