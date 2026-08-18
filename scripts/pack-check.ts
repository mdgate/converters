import { spawnSync } from 'node:child_process';
import { loadPublished, publishOrder, ROOT } from './packages.ts';
import { sharedVersion } from './version.ts';

const pkgs = publishOrder(loadPublished());
try {
  const version = sharedVersion(pkgs);
  console.log(`${pkgs.length} packages at ${version}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const args = ['pack', ...pkgs.flatMap((pkg) => ['-w', pkg.json.name!]), '--dry-run'];
const result = spawnSync('npm', args, { cwd: ROOT, stdio: 'inherit' });
process.exit(result.status ?? 1);
