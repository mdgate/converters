/**
 * Keep every published @mdgate/* package on one version.
 *
 *   bun scripts/version.ts --check
 *   bun scripts/version.ts 0.4.0
 *   bun scripts/version.ts patch | minor | major
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const PACKAGES = join(ROOT, 'packages');
const DEP_FIELDS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'devDependencies',
] as const;

type Manifest = {
  name?: string;
  version?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type Pkg = { dir: string; path: string; json: Manifest };

function loadPublished(): Pkg[] {
  const pkgs: Pkg[] = [];
  for (const name of readdirSync(PACKAGES).sort()) {
    const path = join(PACKAGES, name, 'package.json');
    const json = JSON.parse(readFileSync(path, 'utf8')) as Manifest;
    if (json.private) continue;
    if (!json.name?.startsWith('@mdgate/')) {
      throw new Error(`${path} is published but not named @mdgate/*`);
    }
    pkgs.push({ dir: name, path, json });
  }
  if (pkgs.length === 0) throw new Error('no published packages under packages/');
  return pkgs;
}

function isExact(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

function bump(version: string, kind: 'patch' | 'minor' | 'major'): string {
  if (!isExact(version)) throw new Error(`cannot bump ${version}`);
  const [major, minor, patch] = version.split('.').map(Number) as [number, number, number];
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major + 1}.0.0`;
}

function pinErrors(pkgs: Pkg[], version: string): string[] {
  const errors: string[] = [];
  for (const pkg of pkgs) {
    if (pkg.json.version !== version) {
      errors.push(`${pkg.json.name} version is ${pkg.json.version}, expected ${version}`);
    }
    for (const field of DEP_FIELDS) {
      const deps = pkg.json[field];
      if (!deps) continue;
      for (const [name, spec] of Object.entries(deps)) {
        if (!name.startsWith('@mdgate/')) continue;
        if (spec === 'workspace:*') continue;
        if (spec !== version) {
          errors.push(`${pkg.json.name} ${field}.${name} is ${spec}, expected ${version}`);
        }
      }
    }
  }
  return errors;
}

function apply(pkgs: Pkg[], version: string): void {
  for (const pkg of pkgs) {
    pkg.json.version = version;
    for (const field of DEP_FIELDS) {
      const deps = pkg.json[field];
      if (!deps) continue;
      for (const name of Object.keys(deps)) {
        if (!name.startsWith('@mdgate/')) continue;
        if (deps[name] === 'workspace:*') continue;
        deps[name] = version;
      }
    }
    writeFileSync(pkg.path, `${JSON.stringify(pkg.json, null, 2)}\n`);
  }
}

const arg = process.argv[2];
if (!arg) {
  console.error('usage: bun scripts/version.ts --check | <x.y.z> | patch | minor | major');
  process.exit(2);
}

const pkgs = loadPublished();

if (arg === '--check') {
  const versions = [...new Set(pkgs.map((p) => p.json.version).filter(Boolean))] as string[];
  if (versions.length !== 1 || !isExact(versions[0]!)) {
    console.error(
      `published packages do not share one x.y.z version:\n${pkgs
        .map((p) => `  ${p.json.name} ${p.json.version}`)
        .join('\n')}`,
    );
    process.exit(1);
  }
  const errors = pinErrors(pkgs, versions[0]!);
  if (errors.length > 0) {
    console.error(`version pins drifted:\n${errors.map((e) => `  ${e}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`${pkgs.length} packages at ${versions[0]}`);
  process.exit(0);
}

const current = pkgs[0]!.json.version ?? '0.0.0';
const next = arg === 'patch' || arg === 'minor' || arg === 'major' ? bump(current, arg) : arg;

if (!isExact(next)) {
  console.error(`invalid version ${next}; use x.y.z`);
  process.exit(2);
}

if (arg === 'patch' || arg === 'minor' || arg === 'major') {
  const errors = pinErrors(pkgs, current);
  if (errors.length > 0) {
    console.error(
      `cannot bump from a drifted tree; pass an explicit x.y.z to realign:\n${errors
        .map((e) => `  ${e}`)
        .join('\n')}`,
    );
    process.exit(1);
  }
}

apply(pkgs, next);
console.log(`${pkgs.length} packages -> ${next}`);
