function headText(bytes: Uint8Array, n = 4096): string {
  const end = Math.min(bytes.length, n);
  let s = '';
  for (let i = 0; i < end; i += 1) s += String.fromCharCode(bytes[i]!);
  return s;
}

export function looksLikeXfdf(bytes: Uint8Array): boolean {
  const head = headText(bytes);
  return /<xfdf\b/i.test(head) || /xmlns\s*=\s*["']http:\/\/ns\.adobe\.com\/xfdf\//i.test(head);
}

export function xfdfToMarkdown(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const lines: string[] = [];
  const re = /<field\b([^>]*)>([\s\S]*?)<\/field>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1]!.match(/\bname\s*=\s*["']([^"']*)["']/i)?.[1]?.trim() ?? '';
    const inner = m[2] ?? '';
    const values = [...inner.matchAll(/<value\b[^>]*>([\s\S]*?)<\/value>/gi)].map((v) =>
      decodeXml(v[1]!.trim()),
    );
    const pieces = [name, ...values].filter((s) => s.length > 0);
    if (pieces.length > 0) lines.push(pieces.join(' '));
  }
  if (lines.length === 0) return '';
  return `${lines.join('\n')}\n`;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
