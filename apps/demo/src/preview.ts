import { marked } from 'marked';

const renderer = new marked.Renderer();
renderer.html = () => '';
renderer.link = ({ href, title, text }) => {
  const safe =
    href.startsWith('https://') ||
    href.startsWith('http://') ||
    href.startsWith('mailto:') ||
    href.startsWith('#');
  const url = safe ? href : '#';
  const titleAttr = title ? ` title="${escapeAttr(title)}"` : '';
  return `<a href="${escapeAttr(url)}"${titleAttr}>${text}</a>`;
};

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

marked.use({
  gfm: true,
  breaks: false,
  renderer,
});

export function renderMarkdown(source: string): string {
  return marked.parse(source, { async: false }) as string;
}
