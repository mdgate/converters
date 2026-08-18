import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import {
  formatReleaseNotes,
  releasePayload,
  repoFromRemote,
  sectionFor,
} from '../scripts/github-release.ts';
import { loadPublished, mdgateDeps, publishOrder } from '../scripts/packages.ts';
import { alreadyPublishedOutput } from '../scripts/publish.ts';
import { decidePatch } from '../scripts/should-publish-patch.ts';
import { bump, isExact, sharedVersion } from '../scripts/version.ts';

test('isExact', () => {
  expect(isExact('0.4.1')).toBe(true);
  expect(isExact('0.5.0-beta.1')).toBe(false);
});

test('bump from an exact version', () => {
  expect(bump('0.4.1', 'patch')).toBe('0.4.2');
  expect(bump('0.4.1', 'minor')).toBe('0.5.0');
  expect(bump('0.4.1', 'major')).toBe('1.0.0');
  expect(() => bump('0.5.0-beta.1', 'patch')).toThrow(/cannot bump/);
});

test('sharedVersion accepts a lockstep tree', () => {
  const pkgs = loadPublished();
  expect(sharedVersion(pkgs)).toMatch(/^\d+\.\d+\.\d+$/);
});

test('publish order lists every published package after its @mdgate deps', () => {
  const pkgs = loadPublished();
  const order = publishOrder(pkgs);
  expect(order).toHaveLength(pkgs.length);
  const index = new Map(order.map((pkg, i) => [pkg.json.name, i]));
  for (const pkg of order) {
    for (const dep of mdgateDeps(pkg)) {
      expect(index.has(dep), `${pkg.json.name} depends on unknown ${dep}`).toBe(true);
      expect(index.get(dep)!).toBeLessThan(index.get(pkg.json.name!)!);
    }
  }
  expect(order.at(-1)?.json.name).toBe('@mdgate/converters');
});

test('alreadyPublishedOutput recognizes npm conflict text', () => {
  expect(
    alreadyPublishedOutput(
      'You cannot publish over the previously published versions of @mdgate/utils@0.4.1',
    ),
  ).toBe(true);
  expect(alreadyPublishedOutput('npm error code EPUBLISHCONFLICT')).toBe(true);
  expect(alreadyPublishedOutput('npm error 409 Conflict previously published')).toBe(true);
  expect(alreadyPublishedOutput('ENOTFOUND registry.npmjs.org')).toBe(false);
});

test('repoFromRemote accepts https and ssh remotes', () => {
  expect(repoFromRemote('https://github.com/mdgate/converters.git')).toBe('mdgate/converters');
  expect(repoFromRemote('git@github.com:mdgate/converters.git')).toBe('mdgate/converters');
});

test('sectionFor groups conventional commit titles', () => {
  expect(sectionFor('* feat(video): add callback converter')).toBe('Features');
  expect(sectionFor('- fix(pdf): decode another cmap')).toBe('Fixes');
  expect(sectionFor('* docs: squash-merge PRs')).toBe('Documentation');
  expect(sectionFor('* ci: auto-publish patches')).toBe('Other Changes');
});

test('formatReleaseNotes groups PRs like a Next.js changelog', () => {
  const body = formatReleaseNotes(
    [
      "## What's Changed",
      '* docs: squash-merge PRs by @asionesjia in https://github.com/mdgate/converters/pull/4',
      '* feat(video): add @mdgate/video callback converter by @asionesjia in https://github.com/mdgate/converters/pull/6',
      '* ci: auto-publish patches by @asionesjia in https://github.com/mdgate/converters/pull/5',
      '* fix(pdf): decode another cmap by @asionesjia in https://github.com/mdgate/converters/pull/8',
      '',
      '**Full Changelog**: https://github.com/mdgate/converters/compare/v0.4.1...v0.5.0',
    ].join('\n'),
  );
  expect(body).toBe(
    [
      '### Features',
      '',
      '- feat(video): add @mdgate/video callback converter by @asionesjia in https://github.com/mdgate/converters/pull/6',
      '',
      '### Fixes',
      '',
      '- fix(pdf): decode another cmap by @asionesjia in https://github.com/mdgate/converters/pull/8',
      '',
      '### Documentation',
      '',
      '- docs: squash-merge PRs by @asionesjia in https://github.com/mdgate/converters/pull/4',
      '',
      '### Other Changes',
      '',
      '- ci: auto-publish patches by @asionesjia in https://github.com/mdgate/converters/pull/5',
      '',
      '**Full Changelog**: https://github.com/mdgate/converters/compare/v0.4.1...v0.5.0',
      '',
    ].join('\n'),
  );
});

test('releasePayload titles the GitHub Release vX.Y.Z', () => {
  expect(releasePayload('0.5.0', { name: 'v0.5.0', body: 'notes\n' })).toEqual({
    tag_name: 'v0.5.0',
    name: 'v0.5.0',
    body: 'notes\n',
    make_latest: 'true',
  });
});

test('explicit prerelease does not rewrite package.json', () => {
  const before = readFileSync('packages/core/package.json', 'utf8');
  const explicit = spawnSync('bun', ['scripts/version.ts', '0.5.0-beta.1'], { encoding: 'utf8' });
  expect(explicit.status).toBe(2);
  expect(readFileSync('packages/core/package.json', 'utf8')).toBe(before);
});

test('decidePatch publishes only ordinary packages/ changes', () => {
  const files = ['packages/pdf/src/pdf.ts'];
  expect(
    decidePatch({
      commitMessage: 'fix(pdf): decode another cmap',
      labels: [],
      changedFiles: files,
      addedPublicPackages: [],
    }),
  ).toEqual({ publish: true, reason: 'packages/ changed' });

  expect(
    decidePatch({
      commitMessage: 'docs: releasing',
      labels: [],
      changedFiles: ['AGENTS.md'],
      addedPublicPackages: [],
    }).publish,
  ).toBe(false);

  expect(
    decidePatch({
      commitMessage: 'release: 0.4.2',
      labels: [],
      changedFiles: files,
      addedPublicPackages: [],
    }).publish,
  ).toBe(false);

  expect(
    decidePatch({
      commitMessage: 'feat(video): add converter',
      labels: ['release:minor'],
      changedFiles: files,
      addedPublicPackages: [],
    }).reason,
  ).toMatch(/release:minor/);

  expect(
    decidePatch({
      commitMessage: 'feat(video): add converter',
      labels: [],
      changedFiles: ['packages/video/package.json', 'packages/converters/package.json'],
      addedPublicPackages: ['packages/video/package.json'],
    }).reason,
  ).toMatch(/new published package/);

  expect(
    decidePatch({
      commitMessage: 'fix(pdf): wip [skip publish]',
      labels: [],
      changedFiles: files,
      addedPublicPackages: [],
    }).publish,
  ).toBe(false);
});
