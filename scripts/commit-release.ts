import { spawnSync } from 'node:child_process';
import { loadPublished, ROOT } from './packages.ts';
import { isExact, sharedVersion } from './version.ts';

const version = sharedVersion(loadPublished());
if (!isExact(version)) {
  console.error(`refusing to tag ${version}; use x.y.z`);
  process.exit(1);
}

function git(args: string[]): void {
  const result = spawnSync('git', args, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

git(['config', 'user.name', 'github-actions[bot]']);
git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
git(['add', ...loadPublished().map((pkg) => pkg.path)]);
git(['commit', '-m', `release: ${version}`]);
git(['tag', `v${version}`]);
git(['push', 'origin', 'HEAD:refs/heads/main']);
git(['push', 'origin', `v${version}`]);
console.log(`tagged v${version}`);
