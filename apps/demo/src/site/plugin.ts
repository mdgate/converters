import { readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { type ConverterPage, LEGACY_SLUGS, PAGES } from './pages';
import { renderConverterPage, renderRobots, renderSitemap } from './render';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function routeSlug(
  url: string | undefined,
): { redirect: string } | { page: ConverterPage } | undefined {
  const path = (url ?? '').split('?')[0] ?? '';
  const slug = path.replace(/^\//, '').replace(/\/$/, '');
  const legacy = LEGACY_SLUGS[slug];
  if (legacy !== undefined) return { redirect: legacy };
  const page = PAGES.find((item) => item.slug === slug);
  return page === undefined ? undefined : { page };
}

export function converterPages(): Plugin {
  const files = new Set(PAGES.map((page) => `${page.slug}.html`));

  function writePages(): void {
    for (const name of readdirSync(root)) {
      if (name.endsWith('-to-markdown.html') && !files.has(name)) {
        unlinkSync(resolve(root, name));
      }
    }
    for (const page of PAGES) {
      writeFileSync(resolve(root, `${page.slug}.html`), renderConverterPage(page));
    }
  }

  return {
    name: 'converter-pages',
    config() {
      writePages();
      return {
        build: {
          rollupOptions: {
            input: {
              main: resolve(root, 'index.html'),
              ...Object.fromEntries(
                PAGES.map((page) => [page.slug, resolve(root, `${page.slug}.html`)]),
              ),
            },
          },
        },
      };
    },
    configureServer(server) {
      server.watcher.unwatch(PAGES.map((page) => resolve(root, `${page.slug}.html`)));
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? '';
        if (path === '/robots.txt') {
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end(renderRobots());
          return;
        }
        if (path === '/sitemap.xml' || path === '/sitemaps.xml') {
          res.setHeader('Content-Type', 'application/xml; charset=utf-8');
          res.end(renderSitemap(PAGES));
          return;
        }
        const route = routeSlug(req.url);
        if (route === undefined) {
          next();
          return;
        }
        if ('redirect' in route) {
          res.statusCode = 302;
          res.setHeader('Location', `/${route.redirect}`);
          res.end();
          return;
        }
        void server.transformIndexHtml(path, renderConverterPage(route.page)).then((html) => {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(html);
        });
      });
      server.watcher.add(resolve(root, 'src/site'));
      server.watcher.on('change', (file) => {
        if (!file.includes('/src/site/')) return;
        writePages();
        server.ws.send({ type: 'full-reload', path: '*' });
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const route = routeSlug(req.url);
        if (route === undefined) {
          next();
          return;
        }
        if ('redirect' in route) {
          res.statusCode = 302;
          res.setHeader('Location', `/${route.redirect}`);
          res.end();
          return;
        }
        const raw = req.url ?? '';
        const query = raw.includes('?') ? raw.slice(raw.indexOf('?')) : '';
        req.url = `/${route.page.slug}.html${query}`;
        next();
      });
    },
    generateBundle() {
      const sitemap = renderSitemap(PAGES);
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: renderRobots(),
      });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: sitemap,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'sitemaps.xml',
        source: sitemap,
      });
      this.emitFile({
        type: 'asset',
        fileName: '_redirects',
        source: Object.entries(LEGACY_SLUGS)
          .map(([from, to]) => `/${from} /${to} 301`)
          .join('\n'),
      });
    },
  };
}
