import { warn } from '@mdgate/utils';
import type { Package } from './archive.js';
import { resolve, type Target } from './path.js';
import { normalizeOoxmlUri, ns } from './xml.js';

/** Well-known OPC relationship types (Transitional form). */
export const relType = {
  OFFICE_DOCUMENT:
    'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  STYLES: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
  NUMBERING: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
  FOOTNOTES: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes',
  ENDNOTES: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes',
} as const;

export type TargetMode = 'internal' | 'external';

export interface Relationship {
  target: string;
  relType: string;
  mode: TargetMode;
}

export class Relationships {
  private readonly map: Map<string, Relationship>;

  constructor(map: Map<string, Relationship> = new Map()) {
    this.map = map;
  }

  get(id: string): Relationship | undefined {
    return this.map.get(id);
  }

  internalTarget(id: string): string | undefined {
    const r = this.map.get(id);
    return r !== undefined && r.mode === 'internal' ? r.target : undefined;
  }

  entries(): IterableIterator<[string, Relationship]> {
    return this.map.entries();
  }

  /** Internal-mode relationship of a given type, lowest id first. */
  firstOfType(type: string): Relationship | undefined {
    let bestId: string | undefined;
    let best: Relationship | undefined;
    for (const [id, r] of this.map) {
      if (r.relType === type && r.mode === 'internal') {
        if (bestId === undefined || id < bestId) {
          bestId = id;
          best = r;
        }
      }
    }
    return best;
  }
}

export function readRels(pkg: Package, part: string): Relationships {
  const root = pkg.optionalXmlPart(part);
  if (root === undefined) return new Relationships();
  const map = new Map<string, Relationship>();
  for (const rel of root.descendants(ns.PKG_RELS, 'Relationship')) {
    const id = rel.attrAny('Id');
    const target = rel.attrAny('Target');
    if (id === undefined || target === undefined) continue;
    const rawMode = rel.attrAny('TargetMode');
    const mode: TargetMode =
      rawMode !== undefined && rawMode.toLowerCase() === 'external' ? 'external' : 'internal';
    const rawType = rel.attrAny('Type') ?? '';
    const type = normalizeOoxmlUri(rawType) ?? rawType;
    map.set(id, { target, relType: type, mode });
  }
  return new Relationships(map);
}

/** A loaded internal relationship target: its resolved part path and bytes. */
export type RelTarget = [string, Uint8Array];

export function relTargetBytes(
  pkg: Package,
  rels: Relationships,
  basePart: string,
  relId: string,
): RelTarget | undefined {
  const rel = rels.get(relId);
  if (rel === undefined || rel.mode !== 'internal') return undefined;
  let target: Target;
  try {
    target = resolve(basePart, rel.target);
  } catch (e) {
    warn(
      `skipping unresolvable relationship target ${JSON.stringify(rel.target)}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return undefined;
  }
  const bytes = pkg.optionalPart(target.path);
  if (bytes === undefined) {
    warn(`relationship target ${target.path} is missing`);
    return undefined;
  }
  return [target.path, bytes];
}

/** Conventional rels part name for a part. */
export function relsPartFor(part: string): string {
  const slash = part.lastIndexOf('/');
  if (slash >= 0) {
    return `${part.slice(0, slash)}/_rels/${part.slice(slash + 1)}.rels`;
  }
  return `_rels/${part}.rels`;
}
