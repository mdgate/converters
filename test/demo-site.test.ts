import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXT_ALIASES, PAGES, REDIRECTS, slugFor } from '../apps/demo/src/site/pages';
import {
  enhanceHomeHtml,
  renderConverterPage,
  renderFormatCatalog,
  renderRedirects,
  renderRobots,
  renderSitemap,
} from '../apps/demo/src/site/render';

const home = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../apps/demo/index.html'),
  'utf8',
);

describe('demo site SEO', () => {
  it('does not generate landing pages for extension aliases', () => {
    const slugs = new Set(PAGES.map((page) => page.slug));
    for (const [from, to] of Object.entries(EXT_ALIASES)) {
      expect(slugs.has(slugFor(from))).toBe(false);
      expect(slugs.has(slugFor(to))).toBe(true);
      expect(REDIRECTS[slugFor(from)]).toBe(slugFor(to));
    }
  });

  it('canonical pages accept alias extensions', () => {
    const jpeg = PAGES.find((page) => page.ext === 'jpeg');
    expect(jpeg?.accept).toContain('.jpeg');
    expect(jpeg?.accept).toContain('.jpg');
    const html = PAGES.find((page) => page.ext === 'html');
    expect(html?.accept).toContain('.html');
    expect(html?.accept).toContain('.htm');
  });

  it('lists every landing slug in the generated homepage catalog', () => {
    const catalog = renderFormatCatalog();
    for (const page of PAGES) {
      expect(catalog).toContain(`href="/${page.slug}"`);
    }
    expect(catalog).not.toContain('jpg-to-markdown');
    expect(catalog).not.toContain('html4-to-markdown');
  });

  it('injects JSON-LD and the catalog into the homepage', () => {
    const html = enhanceHomeHtml(home);
    expect(html).toContain('application/ld+json');
    expect(html).toContain('"@type":"WebSite"');
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain('graphql-to-markdown');
    expect(html).toContain('ibooks-to-markdown');
    expect(html).toContain('sxw-to-markdown');
  });

  it('emits FAQ, app, and breadcrumb JSON-LD on converter pages', () => {
    const page = PAGES.find((item) => item.ext === 'docx');
    expect(page).toBeDefined();
    const html = renderConverterPage(page!);
    expect(html).toContain('application/ld+json');
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain('"@type":"WebApplication"');
    expect(html).toContain('"@type":"BreadcrumbList"');
    expect(html).toContain('og:site_name');
    expect(html).toContain('twitter:title');
    expect(html.match(/<title>[^<]{1,60}<\/title>/)).not.toBeNull();
  });

  it('points robots.txt at sitemap.xml and 301s aliases', () => {
    expect(renderRobots()).toContain('Sitemap: https://convert.mdgate.dev/sitemap.xml');
    expect(renderRobots()).not.toContain('sitemaps.xml');
    const sitemap = renderSitemap(PAGES);
    expect(sitemap).toContain('https://convert.mdgate.dev/docx-to-markdown');
    expect(sitemap).not.toContain('jpg-to-markdown');
    const redirects = renderRedirects();
    expect(redirects).toContain('/jpg-to-markdown /jpeg-to-markdown 301');
    expect(redirects).toContain('/audio-to-markdown /mp3-to-markdown 301');
    expect(redirects).toContain('/sitemaps.xml /sitemap.xml 301');
  });
});
