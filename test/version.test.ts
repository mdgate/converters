import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
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

test('published packages declare homepage and repository', () => {
  for (const pkg of loadPublished()) {
    const json = JSON.parse(readFileSync(pkg.path, 'utf8')) as {
      homepage?: string;
      repository?: { type?: string; url?: string; directory?: string };
    };
    expect(json.homepage, pkg.json.name).toBe('https://convert.mdgate.dev');
    expect(json.repository, pkg.json.name).toEqual({
      type: 'git',
      url: 'git+https://github.com/mdgate/converters.git',
      directory: `packages/${pkg.dir}`,
    });
  }
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
