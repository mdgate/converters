/**
 * The lowercased extension of a path's basename (no leading dot), or
 * undefined when there is none. The path is only ever a string hint; it is
 * never read from disk.
 */
export function fileExtension(filePath: string): string | undefined {
  const base = filePath.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return undefined;
  return base.slice(dot + 1).toLowerCase();
}
