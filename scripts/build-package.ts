import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

rmSync('dist', { recursive: true, force: true });

const tsc = Bun.spawnSync(['tsc', '--emitDeclarationOnly'], {
  stdout: 'inherit',
  stderr: 'inherit',
});
if (tsc.exitCode !== 0) process.exit(tsc.exitCode ?? 1);

const build = Bun.spawnSync(
  [
    'bun',
    'build',
    'src/index.ts',
    '--outfile',
    'dist/index.js',
    '--minify',
    '--format',
    'esm',
    '--target',
    'browser',
    '--packages',
    'external',
    '--sourcemap=none',
  ],
  { stdout: 'inherit', stderr: 'inherit' },
);
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);

const publicDts = new Set<string>();
function keepDts(file: string): void {
  const resolved = resolve(file);
  if (publicDts.has(resolved)) return;
  publicDts.add(resolved);
  const text = readFileSync(resolved, 'utf8');
  for (const match of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    let spec = match[1]!;
    if (spec.endsWith('.js')) spec = spec.slice(0, -3);
    keepDts(join(dirname(resolved), `${spec}.d.ts`));
  }
}
keepDts('dist/index.d.ts');

function prune(dir: string): boolean {
  let empty = true;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (prune(path)) rmSync(path, { recursive: true });
      else empty = false;
      continue;
    }
    if (path.endsWith('.d.ts') && !publicDts.has(resolve(path))) {
      rmSync(path);
      continue;
    }
    empty = false;
  }
  return empty;
}
prune('dist');
