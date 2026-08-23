import type { ConverterPage } from './pages';
import { PAGE_BY_EXT } from './pages';

const SITE = 'https://convert.mdgate.dev';
const GITHUB = 'https://github.com/mdgate/converters';
const GITHUB_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8"
              />
            </svg>`;
const NPM_ICON = `<svg viewBox="0 0 18 18" aria-hidden="true">
              <path
                fill="currentColor"
                fill-rule="evenodd"
                d="M0 0h18v18H0V0zm3 3h12v12h-3V6H9v9H3V3z"
              />
            </svg>`;
const FRAME = `<svg class="frame" aria-hidden="true">
          <line x1="0.5" y1="0" x2="0.5" y2="100%" />
          <line x1="100%" y1="0" x2="100%" y2="100%" transform="translate(-0.5 0)" />
        </svg>`;
const CORNER = `<path
            d="M4 0H11V7H10C10 3.68629 7.31371 1 4 1V0Z"
            fill="currentColor"`;
const JUNCTIONS = `<svg class="junction top" aria-hidden="true">
          <line x1="0" y1="10.5" x2="100%" y2="10.5" />
          ${CORNER}
            transform="rotate(180 5.5 5.5)"
          />
          ${CORNER}
            transform="translate(0 10) rotate(-90 5.5 5.5)"
          />
          <svg x="100%" overflow="visible" aria-hidden="true">
            ${CORNER}
              transform="translate(-11 0) rotate(90 5.5 5.5)"
            />
            ${CORNER}
              transform="translate(-11 10)"
            />
          </svg>
        </svg>
        <svg class="junction bottom" aria-hidden="true">
          <line x1="0" y1="10.5" x2="100%" y2="10.5" />
          ${CORNER}
            transform="rotate(180 5.5 5.5)"
          />
          ${CORNER}
            transform="translate(0 10) rotate(-90 5.5 5.5)"
          />
          <svg x="100%" overflow="visible" aria-hidden="true">
            ${CORNER}
              transform="translate(-11 0) rotate(90 5.5 5.5)"
            />
            ${CORNER}
              transform="translate(-11 10)"
            />
          </svg>
        </svg>`;

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function lockup(href: string): string {
  return `<a class="lockup" href="${esc(href)}">
          <img src="/favicon.svg" width="22" height="22" alt="" />
          <span class="wordmark">mdgate</span>
          <span class="slash" aria-hidden="true">/</span>
          <span class="repo">converters</span>
        </a>`;
}

function snippet(page: ConverterPage): string {
  const pkg = `@mdgate/${page.pkg}`;
  if (page.snippet === 'callback') {
    return `<span class="cmt">// Register the callback your app already uses</span>
import { create } from '@mdgate/core';
import { ${page.pkg} } from '${pkg}';

const toMarkdown = create([
  ${page.pkg}(yourCallback),
]);

const markdown = await toMarkdown(bytes);`;
  }
  return `import { toMarkdown } from '${pkg}';

const markdown = await toMarkdown(bytes);`;
}

function sample(page: ConverterPage): string {
  if (page.sample === undefined) return '';
  return `<p class="samples">
            <button type="button" data-sample="${esc(page.sample.file)}">${esc(page.sample.button)}</button>
          </p>`;
}

function split(page: ConverterPage): string {
  if (page.split === undefined) return '';
  return `<section class="band" id="split">
          <h2>${esc(page.split.leftTitle)} vs ${esc(page.split.rightTitle)}</h2>
          <div class="split">
            <article>
              <h3>${esc(page.split.leftTitle)}</h3>
              <p class="pipe">${esc(page.split.left)}</p>
            </article>
            <article>
              <h3>${esc(page.split.rightTitle)}</h3>
              <p class="pipe">${esc(page.split.right)}</p>
            </article>
          </div>
          <p class="prose">${esc(page.split.note)}</p>
        </section>`;
}

function related(page: ConverterPage): string {
  const links = page.related
    .map((ext) => {
      const other = PAGE_BY_EXT.get(ext);
      if (other === undefined) return '';
      return `<li><a href="/${esc(other.slug)}">${esc(other.name)} to Markdown</a></li>`;
    })
    .join('');
  return `<section class="band" id="related">
          <h2>Related converters</h2>
          <ul class="related">${links}</ul>
        </section>`;
}

export function renderConverterPage(page: ConverterPage): string {
  const pkg = `@mdgate/${page.pkg}`;
  const url = `${SITE}/${page.slug}`;
  const npm = `https://www.npmjs.com/package/${pkg}`;
  const githubPkg = `${GITHUB}/tree/main/packages/${page.pkg}`;
  const title = `${page.name} to Markdown - convert ${page.files} in your browser | mdgate`;
  const description = `Convert ${page.files} to GitHub-Flavored Markdown directly in your browser. ${page.stay} stays on your device. No upload. No account.`;
  const [composeA, composeB] = page.compose;
  const config = JSON.stringify({ pkg: page.pkg, name: page.name }).replace(/</g, '\\u003c');
  const faq = page.faq
    .map((item) => `<h3>${esc(item.q)}</h3>\n          <p>${esc(item.a)}</p>`)
    .join('\n          ');
  const extracts = page.extracts.map((item) => `<li>${esc(item)}</li>`).join('');
  const why = page.why
    .map(
      (item) =>
        `<article>\n              <h3>${esc(item.title)}</h3>\n              <p>${esc(item.body)}</p>\n            </article>`,
    )
    .join('\n            ');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <link rel="canonical" href="${esc(url)}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${esc(url)}" />
    <meta property="og:image" content="${SITE}/og.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content="${SITE}/og.png" />
    <meta name="color-scheme" content="light dark" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="stylesheet" href="/src/styles.css" />
  </head>
  <body>
    <div class="page">
      <header class="top rail">
        ${FRAME}
        ${lockup('/')}
        <nav>
          <a href="/#formats">Formats</a>
          <a href="/#developers">Developers</a>
          <a href="${GITHUB}">
            ${GITHUB_ICON}
            <span>GitHub</span>
          </a>
          <a class="pkg" href="${esc(npm)}">
            ${NPM_ICON}
            <span>npm</span>
          </a>
        </nav>
      </header>

      <main class="rail">
        ${FRAME}
        ${JUNCTIONS}

        <section class="band hero">
          <h1>${esc(page.name)} to Markdown <span class="accent">in your browser.</span></h1>
          <p class="lede">
            Convert ${esc(page.files)} to GitHub-Flavored Markdown
            directly in your browser.
          </p>
          <p class="stay">${esc(page.stay)} stays on your device. No upload. No account.</p>
          <ul class="badges">
            <li>
              <a href="${esc(npm)}">
                <span class="key">npm</span>
                <span class="value">${esc(pkg)}</span>
              </a>
            </li>
            <li>
              <a href="${GITHUB}/blob/main/LICENSE">
                <span class="key">license</span>
                <span class="value">MIT</span>
              </a>
            </li>
            <li>
              <span class="key">runtime</span>
              <span class="value">Node.js · Edge · browser</span>
            </li>
          </ul>
        </section>

        <section class="band convert">
          <button class="drop" id="drop" type="button" aria-describedby="drop-hint" disabled>
            <svg class="drop-mark" viewBox="0 0 48 48" aria-hidden="true">
              <rect x="8" y="6" width="32" height="36" rx="4" />
              <path d="M16 18h16M16 24h16M16 30h10" />
            </svg>
            <span class="big" id="drop-title">Drop a file here</span>
            <span class="small" id="drop-hint">or <u>browse</u> for one. Conversion happens locally, nothing is uploaded.</span>
          </button>
          <p class="status" id="status">
            <span class="dot" aria-hidden="true"></span>
            <span id="status-label">Starting local converter</span>
          </p>
          <input id="file" type="file" hidden accept="${esc(page.accept)}" />
          ${sample(page)}
        </section>

        <section class="band result" id="result" hidden aria-live="polite">
          <div class="result-bar">
            <span class="name" id="result-name"></span>
            <span class="arrow" id="result-arrow" hidden>→</span>
            <span id="result-stats"></span>
            <span class="spacer"></span>
            <fieldset class="view" id="view" hidden>
              <legend class="sr-only">Result view</legend>
              <button type="button" id="view-preview" aria-pressed="true">Preview</button>
              <button type="button" id="view-source" aria-pressed="false">Markdown</button>
            </fieldset>
            <button type="button" id="copy" hidden>Copy Markdown</button>
            <button type="button" id="download" hidden>Download .md</button>
          </div>
          <article class="preview" id="preview"></article>
          <pre class="output" id="output" hidden></pre>
          <aside class="help" id="help" hidden>
            <h3 id="help-title">This file needs a model callback</h3>
            <p id="help-lede"></p>
            <p id="help-body"></p>
            <p class="help-cmd">
              <span class="dollar">$</span>
              <code class="cmd" id="help-cmd"></code>
            </p>
            <p>
              <a id="help-link" href="${esc(githubPkg)}">Read the package README</a>
            </p>
          </aside>
        </section>

        <section class="band" id="developers">
          <h2>Use ${esc(page.name)} to Markdown in your app</h2>
          <p class="install-line">
            <span class="dollar">$</span>
            <code class="cmd">npm install ${esc(pkg)}</code>
          </p>
          <pre class="snippet"><code>${snippet(page)}</code></pre>
          <p class="facts-line">
            Pure TypeScript, Node.js, Cloudflare Workers, Edge, Browser, No Python, No native addons, No WASM, Zero third-party runtime dependencies
          </p>
        </section>

        <section class="band" id="how">
          <h2>How ${esc(page.name)} to Markdown works</h2>
          <ol class="flow" aria-label="${esc(page.name)} becomes Markdown">
            <li><span class="flow-out">${esc(page.how.source)}</span></li>
            <li><span class="flow-step">${esc(page.how.parse)}</span></li>
            <li><span class="flow-step">${esc(page.how.structure)}</span></li>
            <li><span class="flow-out">GitHub-Flavored Markdown</span></li>
          </ol>
        </section>

        <section class="band" id="runtimes">
          <h2>Built for JavaScript runtimes</h2>
          <div class="why">
            <article>
              <h3>Node.js</h3>
              <p>${esc(page.runtimes.node)}</p>
            </article>
            <article>
              <h3>Cloudflare Workers</h3>
              <p>${esc(page.runtimes.workers)}</p>
            </article>
            <article>
              <h3>Browser</h3>
              <p>${esc(page.runtimes.browser)}</p>
            </article>
            <article>
              <h3>Edge</h3>
              <p>${esc(page.runtimes.edge)}</p>
            </article>
          </div>
        </section>

        <section class="band" id="extracts">
          <h2>What ${esc(pkg)} extracts</h2>
          <ul class="extracts">${extracts}</ul>
        </section>

        ${split(page)}

        <section class="band" id="why">
          <h2>Why ${esc(pkg)}</h2>
          <div class="why">
            ${why}
          </div>
        </section>

        <section class="band" id="agents">
          <h2>${esc(page.name)} for AI agents</h2>
          <p class="prose">
            Turn ${esc(page.files)} into content your agent can actually work with.
          </p>
          <ol class="flow" aria-label="${esc(page.name)} becomes Markdown, then grep, search, chunk, index, cache, cite, and reason">
            <li><span class="flow-out">${esc(page.name)}</span></li>
            <li><span class="flow-out">Markdown</span></li>
            <li>
              <ul>
                <li>grep</li>
                <li>search</li>
                <li>chunk</li>
                <li>index</li>
                <li>cache</li>
                <li>cite</li>
                <li>reason</li>
              </ul>
            </li>
          </ol>
        </section>

        <section class="band" id="compose">
          <h2>Need more than ${esc(page.name)}?</h2>
          <div class="compose">
            <article>
              <h3>One format</h3>
              <p><code>${esc(pkg)}</code></p>
            </article>
            <article>
              <h3>Your own set</h3>
              <p class="compose-set">
                <code>@mdgate/core</code><br />
                + <code>${esc(pkg)}</code><br />
                + <code>@mdgate/${esc(composeA)}</code><br />
                + <code>@mdgate/${esc(composeB)}</code>
              </p>
            </article>
            <article>
              <h3>Broad file support</h3>
              <p><code>@mdgate/converters</code></p>
            </article>
          </div>
        </section>

        ${related(page)}

        <section class="band" id="faq">
          <h2>FAQ</h2>
          ${faq}
        </section>
      </main>

      <footer class="rail">
        ${FRAME}
        <span>Local conversion · nothing is uploaded</span>
        <a href="${GITHUB}">Source</a>
        <a href="${GITHUB}/issues">Issues</a>
        <a href="${GITHUB}/blob/main/LICENSE">MIT</a>
      </footer>
    </div>
    <script type="application/json" id="page-config">${config}</script>
    <script type="module" src="/src/convert-page.ts"></script>
  </body>
</html>
`;
}

export function renderSitemap(pages: ConverterPage[]): string {
  const urls = [
    `  <url><loc>${SITE}/</loc></url>`,
    ...pages.map((page) => `  <url><loc>${SITE}/${page.slug}</loc></url>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}
