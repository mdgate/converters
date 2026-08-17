import { type Element, ns } from '@mdgate/containers';

/**
 * Pick the branch of an `mc:AlternateContent`: the first `mc:Choice` whose
 * `Requires` namespaces are all supported, else the `mc:Fallback`.
 */
export function alternateBranch(alt: Element, supported: readonly string[]): Element | undefined {
  for (const c of alt.findAll(ns.MC, 'Choice')) {
    if (choiceSupported(c, supported)) return c;
  }
  return alt.find(ns.MC, 'Fallback');
}

function choiceSupported(choice: Element, supported: readonly string[]): boolean {
  const requires = choice.attr(ns.MC, 'Requires');
  if (requires === undefined) return true;
  for (const uri of requires.split(/\s+/)) {
    if (uri.length === 0) continue;
    if (!supported.includes(uri)) return false;
  }
  return true;
}
