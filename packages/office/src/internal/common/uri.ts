/** True when `s` starts with an RFC 3986 scheme followed by `:`. */
function hasScheme(s: string): boolean {
  const colon = s.indexOf(':');
  if (colon < 0) return false;
  const scheme = s.slice(0, colon);
  if (scheme.length === 0) return false;
  const first = scheme.charCodeAt(0);
  if (!((first >= 65 && first <= 90) || (first >= 97 && first <= 122))) return false;
  for (let i = 1; i < scheme.length; i += 1) {
    const c = scheme.charCodeAt(i);
    const ok =
      (c >= 65 && c <= 90) ||
      (c >= 97 && c <= 122) ||
      (c >= 48 && c <= 57) ||
      c === 43 ||
      c === 45 ||
      c === 46;
    if (!ok) return false;
  }
  return true;
}

/** Windows drive-letter paths parse as a one-letter scheme but are local files. */
function isDrivePath(s: string): boolean {
  if (s.length < 3) return false;
  const a = s.charCodeAt(0);
  const letter = (a >= 65 && a <= 90) || (a >= 97 && a <= 122);
  return letter && s.charCodeAt(1) === 58 && (s.charCodeAt(2) === 92 || s.charCodeAt(2) === 47);
}

/** True when `s` should be treated as an absolute URI with a scheme. */
export function isAbsoluteUri(s: string): boolean {
  return hasScheme(s) && !isDrivePath(s);
}
