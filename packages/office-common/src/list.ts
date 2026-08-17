import { type Block, type List, type MarkerKind, markerIsOrdered } from '@mdgate/document';

export type { MarkerKind };

/** Identity of a resolved list at one level. */
export interface ListKey {
  instance: number;
  marker: MarkerKind;
}

export function listKeysEqual(a: ListKey, b: ListKey): boolean {
  return a.instance === b.instance && a.marker === b.marker;
}

/** One flat, fully resolved list paragraph. */
export interface ListEntry {
  level: number;
  key: ListKey;
  /** Effective item number at this entry (ignored for bullets). */
  number: number;
  label: string | undefined;
  blocks: Block[];
}

/** Pop the accumulated run of list paragraphs into list blocks. */
export function flushList(blocks: Block[], run: ListEntry[]): void {
  const entries = run.splice(0, run.length);
  if (entries.length === 0) return;
  blocks.push(...buildLists(entries));
}

function buildLists(entries: ListEntry[]): Block[] {
  if (entries.length === 0) return [];
  let minLvl = entries[0]!.level;
  for (const e of entries) {
    if (e.level < minLvl) minLvl = e.level;
  }
  const out: Block[] = [];
  let current: { list: List; key: ListKey; lastNumber: number } | undefined;

  const flushCurrent = (): void => {
    if (current !== undefined && current.list.items.length > 0) {
      out.push({ type: 'list', list: current.list });
    }
    current = undefined;
  };

  let i = 0;
  while (i < entries.length) {
    const peek = entries[i]!;
    if (peek.level <= minLvl) {
      const entry = entries[i]!;
      i += 1;
      const split =
        current === undefined ||
        !listKeysEqual(current.key, entry.key) ||
        (markerIsOrdered(entry.key.marker) && current.lastNumber + 1 !== entry.number);
      if (split) {
        flushCurrent();
        current = {
          list: {
            marker: entry.key.marker,
            start: markerIsOrdered(entry.key.marker) ? entry.number : 1,
            items: [],
          },
          key: entry.key,
          lastNumber: entry.number,
        };
      }
      current!.list.items.push({
        blocks: entry.blocks,
        checked: undefined,
        markerLabel: entry.label,
      });
      current!.lastNumber = entry.number;
    } else {
      const sub: ListEntry[] = [];
      while (i < entries.length && entries[i]!.level > minLvl) {
        sub.push(entries[i]!);
        i += 1;
      }
      const sublists = buildLists(sub);
      if (sublists.length === 0) continue;
      if (current === undefined) {
        current = {
          list: { marker: 'bullet', start: 1, items: [] },
          key: { instance: Number.MAX_SAFE_INTEGER, marker: 'bullet' },
          lastNumber: 0,
        };
      }
      if (current.list.items.length === 0) {
        current.list.items.push({ blocks: [], checked: undefined, markerLabel: undefined });
      }
      current.list.items[current.list.items.length - 1]!.blocks.push(...sublists);
    }
  }
  flushCurrent();
  return out;
}
