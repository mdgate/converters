/**
 * Publish every public @mdgate/* package in dependency order.
 *
 *   bun scripts/publish.ts
 *   bun scripts/publish.ts --dry-run
 */
import { spawnSync } from 'node:child_process';
import { loadPublished, publishOrder, ROOT } from './packages.ts';
import { isExact, registryUrl, sharedVersion } from './version.ts';

const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 5_000;

export function alreadyPublishedOutput(output: string): boolean {
  const lower = output.toLowerCase();
  return (
    lower.includes('cannot publish over the previously published versions') ||
    lower.includes('epublishconflict') ||
    (lower.includes('previously published') && /\b409\b/.test(output))
  );
}

export async function isPublished(name: string, version: string): Promise<boolean> {
  const response = await fetch(`${registryUrl(name)}/${version}`, {
    headers: { accept: 'application/json' },
  });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`npm registry ${name}@${version}: HTTP ${response.status}`);
  return true;
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

function publishOnce(name: string, dryRun: boolean): { ok: boolean; output: string } {
  const args = ['publish', '-w', name, '--access', 'public'];
  if (dryRun) args.push('--dry-run');
  const result = spawnSync('npm', args, { encoding: 'utf8', cwd: ROOT });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return { ok: result.status === 0, output };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function main(argv: string[]): Promise<number> {
  let dryRun = false;
  try {
    dryRun = parseArgs(argv).dryRun;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    console.error('usage: bun scripts/publish.ts [--dry-run]');
    return 2;
  }

  const pkgs = publishOrder(loadPublished());
  let version: string;
  try {
    version = sharedVersion(pkgs);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }

  if (!isExact(version)) {
    console.error(`publish requires x.y.z, got ${version}`);
    return 1;
  }

  console.log(`publishing ${pkgs.length} packages at ${version}`);

  for (const pkg of pkgs) {
    const name = pkg.json.name!;
    if (!dryRun && (await isPublished(name, version))) {
      console.log(`skip ${name}@${version} (already on npm)`);
      continue;
    }

    let lastOutput = '';
    let published = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const result = publishOnce(name, dryRun);
      lastOutput = result.output;
      if (result.ok) {
        published = true;
        break;
      }
      if (alreadyPublishedOutput(result.output)) {
        console.log(`skip ${name}@${version} (already on npm)`);
        published = true;
        break;
      }
      if (attempt === MAX_ATTEMPTS) break;
      console.error(
        `retry ${name} in ${RETRY_DELAY_MS / 1000}s (attempt ${attempt} of ${MAX_ATTEMPTS})`,
      );
      process.stderr.write(result.output);
      await sleep(RETRY_DELAY_MS);
    }

    if (!published) {
      process.stderr.write(lastOutput);
      console.error(`failed to publish ${name}@${version}`);
      return 1;
    }

    if (!alreadyPublishedOutput(lastOutput)) {
      console.log(`${dryRun ? 'packed' : 'published'} ${name}@${version}`);
    }
  }

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
