import { ConvertError } from '@mdgate/core';

/** Style id -> (definition, parent style id). */
export class StyleChains<D> {
  private readonly raw = new Map<string, { def: D; parent: string | undefined }>();

  insert(id: string, def: D, parent: string | undefined): void {
    this.raw.set(id, { def, parent });
  }

  definition(id: string): D | undefined {
    return this.raw.get(id)?.def;
  }

  /**
   * Walk a chain child-to-root. Unknown ids end the walk; a cycle hard-fails.
   */
  walk<T>(id: string, visit: (def: D) => T | undefined): T | undefined {
    const visited = new Set<string>();
    let cursor: string | undefined = this.raw.has(id) ? id : undefined;
    while (cursor !== undefined) {
      if (visited.has(cursor)) {
        throw ConvertError.malformed(`style inheritance cycle at ${JSON.stringify(cursor)}`);
      }
      visited.add(cursor);
      const entry = this.raw.get(cursor)!;
      const hit = visit(entry.def);
      if (hit !== undefined) return hit;
      const parent = entry.parent;
      cursor = parent !== undefined && this.raw.has(parent) ? parent : undefined;
    }
    return undefined;
  }
}
