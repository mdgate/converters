/**
 * Keep every published @mdgate/* package on one version.
 *
 *   bun scripts/version.ts --check
 *   bun scripts/version.ts 0.4.0
 *   bun scripts/version.ts patch | minor | major
 */
import { applyVersion, type Increment, loadPublished, type Pkg, pinErrors } from './packages.ts';

export function isExact(version: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(version);
}

export function bump(version: string, kind: Increment): string {
  if (!isExact(version)) throw new Error(`cannot bump ${version}`);
  const [major, minor, patch] = version.split('.').map(Number) as [number, number, number];
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major + 1}.0.0`;
}

export function sharedVersion(pkgs: Pkg[]): string {
  const versions = [...new Set(pkgs.map((pkg) => pkg.json.version).filter(Boolean))] as string[];
  if (versions.length !== 1 || !isExact(versions[0]!)) {
    throw new Error(
      `published packages do not share one x.y.z version:\n${pkgs
        .map((pkg) => `  ${pkg.json.name} ${pkg.json.version}`)
        .join('\n')}`,
    );
  }
  const version = versions[0]!;
  const errors = pinErrors(pkgs, version);
  if (errors.length > 0) {
    throw new Error(`version pins drifted:\n${errors.map((line) => `  ${line}`).join('\n')}`);
  }
  return version;
}

export function registryUrl(name: string): string {
  return `https://registry.npmjs.org/${name.replace('/', '%2F')}`;
}

function isIncrement(value: string | undefined): value is Increment {
  return value === 'patch' || value === 'minor' || value === 'major';
}

const USAGE = 'usage: bun scripts/version.ts --check | <x.y.z> | patch | minor | major';

export function main(argv: string[]): number {
  const arg = argv[0];
  if (!arg) {
    console.error(USAGE);
    return 2;
  }

  const pkgs = loadPublished();

  if (arg === '--check') {
    try {
      const version = sharedVersion(pkgs);
      console.log(`${pkgs.length} packages at ${version}`);
      return 0;
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      return 1;
    }
  }

  const current = pkgs[0]!.json.version ?? '0.0.0';
  const next = isIncrement(arg) ? bump(current, arg) : arg;

  if (!isExact(next)) {
    console.error(`invalid version ${next}; use x.y.z`);
    return 2;
  }

  if (isIncrement(arg)) {
    const errors = pinErrors(pkgs, current);
    if (errors.length > 0) {
      console.error(
        `cannot bump from a drifted tree; pass an explicit x.y.z to realign:\n${errors
          .map((line) => `  ${line}`)
          .join('\n')}`,
      );
      return 1;
    }
  }

  applyVersion(pkgs, next);
  console.log(`${pkgs.length} packages -> ${next}`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
