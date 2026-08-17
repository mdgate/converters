function startsWithAscii(bytes: Uint8Array, text: string): boolean {
  if (bytes.length < text.length) return false;
  for (let i = 0; i < text.length; i += 1) {
    if (bytes[i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 1024);
  for (let i = 0; i + 5 <= n; i += 1) {
    if (
      bytes[i] === 0x25 &&
      bytes[i + 1] === 0x50 &&
      bytes[i + 2] === 0x44 &&
      bytes[i + 3] === 0x46 &&
      bytes[i + 4] === 0x2d
    ) {
      return true;
    }
  }
  return false;
}

function extensionOf(path: string): string | undefined {
  const base = path.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return undefined;
  return base.slice(dot + 1).toLowerCase();
}

/** Display label only. The converter sniffs bytes itself. */
export function formatLabel(path: string, bytes: Uint8Array): string {
  if (startsWithAscii(bytes, '{\\rtf')) return 'rtf';
  if (hasPdfMagic(bytes)) return 'pdf';
  return extensionOf(path) ?? 'file';
}

export function stemOf(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? 'document';
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return base || 'document';
  return base.slice(0, dot) || 'document';
}
