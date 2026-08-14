import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PACKAGES = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'packages');
const NODE_IMPORT = /from\s+['"]node:|require\(\s*['"]node:/;

function walkTs(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkTs(path, out);
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(path);
  }
}

describe('portable runtime', () => {
  it('library sources do not import node builtins', () => {
    const hits: string[] = [];
    for (const name of ['core', 'utils', 'office', 'pdf', 'ai', 'converters']) {
      const files: string[] = [];
      walkTs(join(PACKAGES, name, 'src'), files);
      for (const file of files) {
        const src = readFileSync(file, 'utf8');
        if (NODE_IMPORT.test(src)) hits.push(file);
      }
    }
    expect(hits).toEqual([]);
  });
});
