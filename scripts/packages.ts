import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PACKAGES_DIR = join(ROOT, 'packages');

export const DEP_FIELDS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'devDependencies',
] as const;

export type Increment = 'patch' | 'minor' | 'major';

export type Manifest = {
  name?: string;
  version?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export type Pkg = { dir: string; path: string; json: Manifest };

export function loadPublished(): Pkg[] {
  const pkgs: Pkg[] = [];
  for (const dir of readdirSync(PACKAGES_DIR).sort()) {
    const path = join(PACKAGES_DIR, dir, 'package.json');
    const json = JSON.parse(readFileSync(path, 'utf8')) as Manifest;
    if (json.private) continue;
    if (!json.name?.startsWith('@mdgate/')) {
      throw new Error(`${path} is published but not named @mdgate/*`);
    }
    pkgs.push({ dir, path, json });
  }
  if (pkgs.length === 0) throw new Error('no published packages under packages/');
  return pkgs;
}

export function mdgateDeps(pkg: Pkg): string[] {
  const names: string[] = [];
  for (const field of DEP_FIELDS) {
    const deps = pkg.json[field];
    if (!deps) continue;
    for (const name of Object.keys(deps)) {
      if (name.startsWith('@mdgate/')) names.push(name);
    }
  }
  return names;
}

export function publishOrder(pkgs: Pkg[]): Pkg[] {
  const byName = new Map(pkgs.map((pkg) => [pkg.json.name!, pkg]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: Pkg[] = [];

  const visit = (name: string): void => {
    const pkg = byName.get(name);
    if (!pkg || visited.has(name)) return;
    if (visiting.has(name)) throw new Error(`dependency cycle involving ${name}`);
    visiting.add(name);
    for (const dep of mdgateDeps(pkg)) visit(dep);
    visiting.delete(name);
    visited.add(name);
    ordered.push(pkg);
  };

  for (const pkg of pkgs) visit(pkg.json.name!);
  return ordered;
}

export function applyVersion(pkgs: Pkg[], version: string): void {
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

export function pinErrors(pkgs: Pkg[], version: string): string[] {
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
