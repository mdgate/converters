import { expect, test } from 'vitest';
import {
  buildCredits,
  cleanupTitle,
  generateChangelog,
  getPullRequestNumber,
  isBotLogin,
  isReleaseTitle,
  type PullRequest,
  parseGitLog,
  previousTagFrom,
  releasePayload,
  repoFromRemote,
  sectionFor,
} from '../scripts/github-release.ts';

test('repoFromRemote accepts https and ssh remotes', () => {
  expect(repoFromRemote('https://github.com/mdgate/converters.git')).toBe('mdgate/converters');
  expect(repoFromRemote('git@github.com:mdgate/converters.git')).toBe('mdgate/converters');
});

test('releasePayload titles the GitHub Release vX.Y.Z', () => {
  expect(releasePayload('0.5.0', { name: 'v0.5.0', body: 'notes\n' })).toEqual({
    tag_name: 'v0.5.0',
    name: 'v0.5.0',
    body: 'notes\n',
    make_latest: 'true',
  });
});

test('previousTagFrom picks the highest exact tag below the new version', () => {
  expect(previousTagFrom(['v0.5.1', 'v0.5.0', 'v0.4.1'], '0.5.1')).toBe('v0.5.0');
  expect(previousTagFrom(['v0.5.1'], '0.5.1')).toBeUndefined();
  expect(previousTagFrom(['v0.5.0-beta.1', 'v0.4.1'], '0.5.0')).toBe('v0.4.1');
});

test('isReleaseTitle matches version-bump commits', () => {
  expect(isReleaseTitle('release: 0.5.1')).toBe(true);
  expect(isReleaseTitle('v0.5.1')).toBe(true);
  expect(isReleaseTitle('0.5.1')).toBe(true);
  expect(isReleaseTitle('feat(pdf): decode another cmap')).toBe(false);
});

test('parseGitLog splits hash and subject on 0x1f', () => {
  expect(parseGitLog('abc\x1ffeature (#1)\ndef\x1frelease: 0.5.1')).toEqual([
    { hash: 'abc', title: 'feature (#1)' },
    { hash: 'def', title: 'release: 0.5.1' },
  ]);
});

test('getPullRequestNumber reads a trailing squash (#N)', () => {
  expect(getPullRequestNumber('docs: squash-merge PRs (#4)')).toBe(4);
  expect(getPullRequestNumber('docs: squash-merge PRs')).toBeUndefined();
  expect(getPullRequestNumber('mentions (#4) in the middle')).toBeUndefined();
});

test('cleanupTitle strips the trailing squash (#N)', () => {
  expect(cleanupTitle('docs: squash-merge PRs (#4)')).toBe('docs: squash-merge PRs');
  expect(cleanupTitle('docs: squash-merge PRs')).toBe('docs: squash-merge PRs');
});

test('isBotLogin treats missing and [bot] logins as bots', () => {
  expect(isBotLogin(undefined)).toBe(true);
  expect(isBotLogin('github-actions[bot]')).toBe(true);
  expect(isBotLogin('asionesjia')).toBe(false);
});

test('sectionFor prefers labels, then conventional prefixes', () => {
  expect(sectionFor({ title: 'feat(video): add converter', labels: [] })).toBe('Core Changes');
  expect(sectionFor({ title: 'fix(pdf): decode another cmap', labels: [] })).toBe('Core Changes');
  expect(sectionFor({ title: 'unlabeled change', labels: ['pkg:pdf'] })).toBe('Core Changes');
  expect(sectionFor({ title: 'unlabeled change', labels: ['enhancement'] })).toBe('Core Changes');
  expect(sectionFor({ title: 'docs: squash-merge PRs', labels: [] })).toBe('Documentation Changes');
  expect(sectionFor({ title: 'chore: edit readme', labels: ['documentation'] })).toBe(
    'Documentation Changes',
  );
  expect(sectionFor({ title: 'Convert the uploaded file', labels: ['demo'] })).toBe('Demo Changes');
  expect(sectionFor({ title: 'ci: auto-publish patches', labels: [] })).toBe('Misc Changes');
  expect(sectionFor({ title: 'docs: and a converter', labels: ['pkg:pdf'] })).toBe('Core Changes');
});

test('buildCredits lists authors like Next.js', () => {
  expect(buildCredits([])).toBe('');
  expect(buildCredits(['asionesjia'])).toBe(
    '### Credits\n\nHuge thanks to @asionesjia for helping!\n',
  );
  expect(buildCredits(['asionesjia', 'ijjk'])).toBe(
    '### Credits\n\nHuge thanks to @asionesjia and @ijjk for helping!\n',
  );
  expect(buildCredits(['asionesjia', 'ijjk', 'styfle'])).toBe(
    '### Credits\n\nHuge thanks to @asionesjia, @ijjk, and @styfle for helping!\n',
  );
});

test('generateChangelog groups PRs like a Next.js release', async () => {
  const pulls = new Map<number, PullRequest>([
    [
      6,
      {
        title: 'feat(video): add @mdgate/video callback converter',
        number: 6,
        labels: [{ name: 'release:minor' }],
        user: { login: 'asionesjia' },
      },
    ],
    [
      8,
      {
        title: 'fix(pdf): decode another cmap',
        number: 8,
        labels: [{ name: 'pkg:pdf' }],
        user: { login: 'ijjk' },
      },
    ],
    [
      4,
      {
        title: 'docs: squash-merge PRs',
        number: 4,
        labels: [],
        user: { login: 'asionesjia' },
      },
    ],
    [
      13,
      {
        title: 'Convert the uploaded file instead of refusing on caps',
        number: 13,
        labels: [{ name: 'demo' }],
        user: { login: 'asionesjia' },
      },
    ],
    [
      5,
      {
        title: 'ci: auto-publish patches and manual minor/major releases',
        number: 5,
        labels: [],
        user: { login: 'github-actions[bot]' },
      },
    ],
  ]);

  const body = await generateChangelog({
    commits: [
      { title: 'release: 0.5.0' },
      { title: 'feat(video): add @mdgate/video callback converter (#6)' },
      { title: 'fix(pdf): decode another cmap (#8)' },
      { title: 'docs: squash-merge PRs (#4)' },
      { title: 'Convert the uploaded file instead of refusing on caps (#13)' },
      { title: 'ci: auto-publish patches and manual minor/major releases (#5)' },
    ],
    getPullRequest: async (number) => pulls.get(number) ?? null,
  });

  expect(body).toBe(
    [
      '### Core Changes',
      '',
      '- feat(video): add @mdgate/video callback converter: #6',
      '- fix(pdf): decode another cmap: #8',
      '',
      '### Documentation Changes',
      '',
      '- docs: squash-merge PRs: #4',
      '',
      '### Demo Changes',
      '',
      '- Convert the uploaded file instead of refusing on caps: #13',
      '',
      '### Misc Changes',
      '',
      '- ci: auto-publish patches and manual minor/major releases: #5',
      '',
      '### Credits',
      '',
      'Huge thanks to @asionesjia and @ijjk for helping!',
      '',
    ].join('\n'),
  );
});

test('generateChangelog keeps a PR number when the pull cannot be fetched', async () => {
  const body = await generateChangelog({
    commits: [{ title: 'Convert the uploaded file instead of refusing on caps (#13)' }],
    getPullRequest: async () => null,
  });
  expect(body).toBe(
    [
      '### Misc Changes',
      '',
      '- Convert the uploaded file instead of refusing on caps: #13',
      '',
    ].join('\n'),
  );
});
