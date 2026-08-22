import { trim, trimEnd, trimStart } from '@mdgate/utils';
import {
  type ImageSource,
  type Inline,
  inlinesAreEmpty,
  type LinkTarget,
  PLAIN,
  type Style,
  stylesEqual,
} from '../model/index.js';
import { linkTargetIsEmpty } from '../model/link.js';
import type { Ctx } from './ctx.js';
import {
  backtickFence,
  escapeOpts,
  escapeText,
  escapeUrlAsText,
  formatUrl,
  type InlineContext,
} from './escape.js';

export type Norm =
  | { type: 'text'; text: string; style: Style }
  | { type: 'link'; content: Inline[]; target: LinkTarget }
  | { type: 'image'; alt: string; source: ImageSource }
  | { type: 'anchor'; id: string }
  | { type: 'noteRef'; id: string }
  | { type: 'lineBreak' };

/**
 * Single-pass normalization: drops empty runs, strips styling from
 * whitespace-only runs, merges adjacent same-style runs, and re-joins styled
 * runs split only by whitespace. Untargeted anchors drop out here.
 */
export function normalize(inlines: readonly Inline[], rc: Ctx): Norm[] {
  const out: Norm[] = [];
  for (const inline of inlines) {
    switch (inline.type) {
      case 'text': {
        if (inline.text.length === 0) continue;
        const style = trim(inline.text).length === 0 ? PLAIN : inline.style;
        const prev = out.length > 0 ? out[out.length - 1] : undefined;
        if (prev !== undefined && prev.type === 'text' && stylesEqual(prev.style, style)) {
          prev.text += inline.text;
          continue;
        }
        if (
          !stylesEqual(style, PLAIN) &&
          !style.code &&
          out.length >= 2 &&
          out[out.length - 1]!.type === 'text' &&
          stylesEqual((out[out.length - 1] as Extract<Norm, { type: 'text' }>).style, PLAIN) &&
          trim((out[out.length - 1] as Extract<Norm, { type: 'text' }>).text).length === 0 &&
          out[out.length - 2]!.type === 'text' &&
          stylesEqual((out[out.length - 2] as Extract<Norm, { type: 'text' }>).style, style)
        ) {
          const ws = out.pop() as Extract<Norm, { type: 'text' }>;
          const prevRun = out[out.length - 1] as Extract<Norm, { type: 'text' }>;
          prevRun.text += ws.text;
          prevRun.text += inline.text;
          continue;
        }
        out.push({ type: 'text', text: inline.text, style });
        break;
      }
      case 'link':
        if (linkTargetIsEmpty(inline.target)) {
          if (!inlinesAreEmpty(inline.content)) out.push(...normalize(inline.content, rc));
          continue;
        }
        out.push({ type: 'link', content: inline.content, target: inline.target });
        break;
      case 'image':
        out.push({ type: 'image', alt: inline.alt, source: inline.source });
        break;
      case 'anchor':
        if (rc.anchors.htmlId(inline.id) === undefined) continue;
        out.push({ type: 'anchor', id: inline.id });
        break;
      case 'noteRef':
        out.push({ type: 'noteRef', id: inline.id });
        break;
      case 'lineBreak':
        out.push({ type: 'lineBreak' });
        break;
    }
  }
  return out;
}

export function renderInlines(inlines: readonly Inline[], ctx: InlineContext, rc: Ctx): string {
  return renderInlinesMode(inlines, ctx, false, rc);
}

function renderInlinesMode(
  inlines: readonly Inline[],
  ctx: InlineContext,
  inLabel: boolean,
  rc: Ctx,
): string {
  const runs = normalize(inlines, rc);
  let out = '';
  for (let idx = 0; idx < runs.length; idx += 1) {
    const run = runs[idx]!;
    switch (run.type) {
      case 'text': {
        const next = runs[idx + 1];
        const nextActive =
          next !== undefined &&
          (next.type === 'link' ||
            next.type === 'image' ||
            next.type === 'noteRef' ||
            (next.type === 'text' && !stylesEqual(next.style, PLAIN)));
        out += renderTextRun(run.text, run.style, ctx, nextActive, inLabel, out);
        break;
      }
      case 'noteRef': {
        const num = rc.nums.get(run.id);
        if (num !== undefined) out += `[^${num}]`;
        break;
      }
      case 'link':
        out += renderLink(run.content, run.target, ctx, rc);
        break;
      case 'image':
        out += renderImage(run.alt, run.source, ctx, inLabel);
        break;
      case 'anchor': {
        const htmlId = rc.anchors.htmlId(run.id);
        if (htmlId !== undefined) out += `<a id="${htmlId}"></a>`;
        break;
      }
      case 'lineBreak':
        if (ctx === 'block') out += '\\\n';
        else if (ctx === 'heading') out += ' ';
        else out += '\n';
        break;
    }
  }
  return out;
}

function renderLink(
  content: readonly Inline[],
  target: LinkTarget,
  ctx: InlineContext,
  rc: Ctx,
): string {
  const label = renderInlinesMode(content, ctx, true, rc);
  let url: string;
  if (target.type === 'external' || target.type === 'relative') {
    url = target.url;
  } else {
    const fragment = rc.anchors.fragment(target.id);
    if (fragment === undefined) {
      return renderInlinesMode(content, ctx, false, rc);
    }
    url = `#${fragment}`;
  }
  if (trim(label).length === 0) {
    if (target.type === 'anchor') return '';
    return `[${escapeUrlAsText(url, ctx)}](${formatUrl(url)})`;
  }
  return `[${label}](${formatUrl(url)})`;
}

function renderImage(
  alt: string,
  source: ImageSource,
  ctx: InlineContext,
  inLabel: boolean,
): string {
  if (source.type === 'external' || source.type === 'relative') {
    const escaped = escapeText(trim(alt), ctx, escapeOpts({ inLabel: true }));
    return `![${escaped}](${formatUrl(source.url)})`;
  }
  if (trim(alt).length === 0) return '';
  return escapeText(trim(alt), ctx, escapeOpts({ inLabel }));
}

function renderTextRun(
  text: string,
  style: Style,
  ctx: InlineContext,
  trailingActive: boolean,
  inLabel: boolean,
  already: string,
): string {
  if (stylesEqual(style, PLAIN)) {
    const atLineStart = already.length === 0 || already.endsWith('\n');
    return escapeText(text, ctx, escapeOpts({ atLineStart, trailingActive, inLabel }));
  }
  const lead = text.slice(0, text.length - trimStart(text).length);
  const trimmedEnd = trimEnd(text);
  const core = text.slice(lead.length, trimmedEnd.length);
  const trail = text.slice(trimmedEnd.length);
  let out = '';
  if (lead.length > 0) out += lead;
  if (core.length > 0) {
    if (style.code) {
      out += pushCodeSpan(core);
    } else {
      let open = '';
      if (style.strike) open += '~~';
      if (style.bold) open += '**';
      if (style.italic) open += '*';
      const close = [...open].reverse().join('');
      out += open;
      out += escapeText(core, ctx, escapeOpts({ styled: true, inLabel }));
      out += close;
    }
  }
  if (trail.length > 0) out += trail;
  return out;
}

export function pushCodeSpan(text: string): string {
  const flat = text.replace(/\n/g, ' ');
  const fence = backtickFence(flat, 1);
  const pad = flat.startsWith('`') || flat.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${flat}${pad}${fence}`;
}
