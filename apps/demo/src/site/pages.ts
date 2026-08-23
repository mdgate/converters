export type Faq = { q: string; a: string };

export type ConverterPage = {
  pkg: string;
  ext: string;
  slug: string;
  name: string;
  stay: string;
  files: string;
  accept: string;
  sample?: { file: string; button: string };
  how: { source: string; parse: string; structure: string };
  extracts: string[];
  runtimes: { node: string; workers: string; browser: string; edge: string };
  split?: { leftTitle: string; left: string; rightTitle: string; right: string; note: string };
  related: string[];
  faq: Faq[];
  why: { title: string; body: string }[];
  snippet: 'default' | 'callback' | 'svg';
  compose: [string, string];
  sniff: string;
  local: boolean;
};

type Family = {
  pkg: string;
  extensions: string[];
  parse: string;
  structure: string;
  extracts: string[];
  node: string;
  workers: string;
  browser: string;
  edge: string;
  related: string[];
  extraFaq?: Faq[];
  snippet?: ConverterPage['snippet'];
  sniff?: string;
  split?: ConverterPage['split'];
  local?: boolean;
};

const PREFERRED_COMPOSE = ['pdf', 'docx', 'pptx', 'xlsx', 'html'] as const;
const POPULAR = ['pdf', 'docx', 'pptx', 'xlsx', 'pages', 'hwp', 'msg', 'html'];

const DISPLAY: Record<string, string> = {
  'fb2.zip': 'FB2.ZIP',
  ibooks: 'iBooks',
  key: 'Keynote',
  markdown: 'Markdown',
  numbers: 'Numbers',
  pages: 'Pages',
  webvtt: 'WebVTT',
};

const SAMPLES: Record<string, string> = {
  hwpx: 'note.hwpx',
  msg: 'meeting.msg',
  pages: 'essay.pages',
  pdf: 'report.pdf',
  pptx: 'deck.pptx',
  xlsx: 'sheet.xlsx',
};

export const LEGACY_SLUGS: Record<string, string> = {
  'audio-to-markdown': 'mp3-to-markdown',
  'data-to-markdown': 'json-to-markdown',
  'email-to-markdown': 'eml-to-markdown',
  'image-to-markdown': 'jpeg-to-markdown',
  'keynote-to-markdown': 'key-to-markdown',
  'odf-to-markdown': 'odt-to-markdown',
  'onenote-to-markdown': 'one-to-markdown',
  'subtitle-to-markdown': 'srt-to-markdown',
  'video-to-markdown': 'mp4-to-markdown',
  'visio-to-markdown': 'vsd-to-markdown',
};

function displayName(ext: string): string {
  return DISPLAY[ext] ?? ext.toUpperCase();
}

function slugFor(ext: string): string {
  return `${ext.replace(/\./g, '-')}-to-markdown`;
}

function fill(template: string, name: string): string {
  return template.replaceAll('{name}', name);
}

function composeFor(pkg: string): [string, string] {
  const picked = PREFERRED_COMPOSE.filter((id) => id !== pkg).slice(0, 2);
  return [picked[0]!, picked[1]!];
}

function relatedFor(ext: string, family: Family): string[] {
  const siblings = family.extensions.filter((item) => item !== ext);
  const extras = [...family.related, ...POPULAR].filter(
    (item) => item !== ext && !siblings.includes(item),
  );
  const picked: string[] = [];
  for (const item of [...siblings, ...extras]) {
    if (picked.includes(item)) continue;
    picked.push(item);
    if (picked.length === 6) break;
  }
  return picked;
}

function defaultWhy(name: string, sniff: string, local: boolean): ConverterPage['why'] {
  return [
    {
      title: 'Runs where your JavaScript runs',
      body: 'No separate processing service. The converter is TypeScript you can call from Node.js, Cloudflare Workers, Edge runtimes, and browsers.',
    },
    {
      title: 'Local conversion',
      body: local
        ? `${name} files can stay inside your application or browser.`
        : 'Detection stays local. Model work happens only through a callback you register.',
    },
    {
      title: 'Content detection',
      body: sniff,
    },
    {
      title: 'Deterministic parsing',
      body: local
        ? `The same ${name} file produces repeatable Markdown without model inference.`
        : 'Format detection is deterministic. Any model output comes from the callback you supply.',
    },
    {
      title: 'Small runtime surface',
      body: 'No Python. No native addons. No WASM. No third-party runtime dependencies.',
    },
  ];
}

function defaultFaq(family: Family, name: string, files: string, local: boolean): Faq[] {
  const upload = local
    ? `Yes. ${files} can be converted locally in the browser.`
    : `Files you drop on this page stay in the browser. ${name} conversion that needs a model still requires a callback in your application.`;
  return [
    {
      q: `Can I convert ${name} to Markdown without uploading it?`,
      a: upload,
    },
    {
      q: `Does ${name} to Markdown work in Cloudflare Workers?`,
      a: `Yes. @mdgate/${family.pkg} runs directly in Cloudflare Workers.`,
    },
    {
      q: 'Does it require Python?',
      a: 'No.',
    },
    {
      q: 'Does it require native addons or WASM?',
      a: 'No.',
    },
    {
      q: 'What does it output?',
      a: 'GitHub-Flavored Markdown.',
    },
    {
      q: `Can I install only the ${name} converter?`,
      a: `Yes. Install @mdgate/${family.pkg} instead of the complete converter set.`,
    },
    ...(family.extraFaq ?? []).map((item) => ({
      q: fill(item.q, name),
      a: fill(item.a, name),
    })),
  ];
}

const FAMILIES: Family[] = [
  {
    pkg: 'docx',
    extensions: ['docx', 'docm', 'dotx', 'dotm'],
    parse: 'WordprocessingML parsing',
    structure: 'headings · lists · tables · notes',
    extracts: [
      'Headings and paragraphs',
      'Bold, italic, and strikethrough',
      'Links',
      'Ordered, unordered, and nested lists',
      'Tables, including merged cells',
      'Footnotes and endnotes',
      'Field results',
      'Charts and diagrams as readable blocks',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers:
      'Parse Word files directly inside Workers without a document service or native binary.',
    browser: 'Convert {name} locally without uploading it to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    related: ['doc', 'pdf', 'pptx', 'xlsx', 'pages', 'rtf'],
  },
  {
    pkg: 'doc',
    extensions: ['doc', 'dot'],
    parse: 'binary Word parsing',
    structure: 'paragraphs · styles · tables',
    extracts: [
      'Paragraphs and heading styles',
      'Bold, italic, and strikethrough',
      'Lists',
      'Tables',
      'Basic character encoding',
      'Encrypted document detection',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers:
      'Parse binary Word files directly inside Workers without Microsoft Word or a native addon.',
    browser: 'Convert {name} locally without uploading it to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    extraFaq: [
      {
        q: 'Does this convert .docx too?',
        a: 'No. OOXML Word files use @mdgate/docx.',
      },
    ],
    related: ['docx', 'rtf', 'pdf', 'wps', 'html', 'pages'],
  },
  {
    pkg: 'rtf',
    extensions: ['rtf'],
    parse: 'RTF control-word parsing',
    structure: 'paragraphs · lists · tables',
    extracts: [
      'Paragraphs and headings',
      'Bold, italic, and strikethrough',
      'Lists',
      'Tables',
      'Unicode and legacy code-page text',
      'RTF content stored under a .doc name',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers: 'Parse RTF directly inside Workers without WordPad, Word, or a native addon.',
    browser: 'Convert {name} locally without uploading it to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    related: ['docx', 'doc', 'pdf', 'html', 'txt', 'pages'],
  },
  {
    pkg: 'pptx',
    extensions: ['pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm'],
    parse: 'slide XML parsing',
    structure: 'titles · body · notes · tables',
    extracts: [
      'Slide titles and body text',
      'Lists',
      'Tables',
      'Speaker notes as a block quote after each slide',
      'Charts and diagrams as readable blocks',
      'Slide, layout, and master text cascade',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers:
      'Parse PowerPoint files directly inside Workers without PowerPoint or a native binary.',
    browser: 'Convert {name} locally without uploading it to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    extraFaq: [
      {
        q: 'Does this convert .ppt too?',
        a: 'No. Binary PowerPoint 97-2003 files use @mdgate/ppt.',
      },
    ],
    related: ['ppt', 'pdf', 'key', 'docx', 'xlsx', 'odp'],
  },
  {
    pkg: 'ppt',
    extensions: ['ppt', 'pps', 'pot'],
    parse: 'binary presentation parsing',
    structure: 'slide text · titles · notes',
    extracts: [
      'Slide text in reading order',
      'Titles and body copy',
      'Lists',
      'Speaker notes when present',
      'Encrypted document detection',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers:
      'Parse binary PowerPoint files directly inside Workers without PowerPoint or a native addon.',
    browser: 'Convert {name} locally without uploading it to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    extraFaq: [
      {
        q: 'Does this convert .pptx too?',
        a: 'No. OOXML decks use @mdgate/pptx.',
      },
    ],
    related: ['pptx', 'pdf', 'key', 'docx', 'odp', 'html'],
  },
  {
    pkg: 'xlsx',
    extensions: ['xlsx', 'xlsm', 'xlsb', 'xls', 'xltx', 'xltm', 'xlt'],
    parse: 'workbook parsing',
    structure: 'sheets · cells · tables',
    extracts: [
      'One Markdown section per sheet',
      'GitHub-Flavored Markdown tables',
      'Merged cells',
      'Header-row detection',
      'Number formats (dates, percents, currency-style text)',
      'Shared strings and typed cell values',
      'Encrypted workbook detection',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers: 'Parse Excel workbooks directly inside Workers without Excel or a native binary.',
    browser: 'Convert {name} locally without uploading it to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    extraFaq: [
      {
        q: 'Does this convert CSV?',
        a: 'No. Use @mdgate/csv for .csv and .tsv.',
      },
    ],
    related: ['csv', 'numbers', 'ods', 'pdf', 'docx', 'pptx'],
  },
  {
    pkg: 'odf',
    extensions: [
      'odt',
      'ods',
      'odp',
      'odg',
      'ott',
      'ots',
      'otp',
      'otg',
      'fodt',
      'fods',
      'fodp',
      'fodg',
      'sxw',
      'sxc',
      'sxi',
      'sxd',
      'stw',
      'stc',
      'sti',
      'std',
    ],
    parse: 'ODF XML parsing',
    structure: 'text · sheets · slides',
    extracts: [
      'Text documents: headings, paragraphs, lists, links, emphasis',
      'Spreadsheets: sheets as Markdown tables',
      'Presentations: slide text in order',
      'Drawings: readable text from the drawing',
      'Styles that map onto headings and emphasis',
      'Tables, including spanning cells',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers:
      'Parse OpenDocument files directly inside Workers without LibreOffice or a native binary.',
    browser: 'Convert {name} locally without uploading it to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    related: ['docx', 'xlsx', 'pptx', 'pages', 'pdf', 'html'],
  },
  {
    pkg: 'pages',
    extensions: ['pages'],
    parse: 'iWork archive parsing',
    structure: 'headings · lists · tables',
    extracts: [
      'Headings and paragraphs',
      'Emphasis',
      'Lists',
      'Tables',
      'Text storage order inside the iWork package',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers: 'Parse Pages files directly inside Workers without iWork or a native binary.',
    browser: 'Convert {name} files locally without uploading them to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    related: ['docx', 'numbers', 'key', 'pdf', 'rtf', 'odt'],
  },
  {
    pkg: 'numbers',
    extensions: ['numbers'],
    parse: 'iWork table parsing',
    structure: 'sheets · tables · cells',
    extracts: [
      'Sheets and tables as Markdown tables',
      'Cell text in table order',
      'Table structure from the iWork archive',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers: 'Parse Numbers files directly inside Workers without Numbers or a native binary.',
    browser: 'Convert {name} files locally without uploading them to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    extraFaq: [
      {
        q: 'Does this convert Excel?',
        a: 'No. Excel workbooks use @mdgate/xlsx.',
      },
    ],
    related: ['xlsx', 'csv', 'pages', 'key', 'ods', 'pdf'],
  },
  {
    pkg: 'keynote',
    extensions: ['key'],
    parse: 'iWork slide parsing',
    structure: 'slides · titles · tables',
    extracts: [
      'Slide text in order',
      'Titles and body copy',
      'Lists',
      'Tables on slides when present',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers: 'Parse Keynote files directly inside Workers without Keynote or a native binary.',
    browser: 'Convert {name} files locally without uploading them to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    extraFaq: [
      {
        q: 'Does this convert PowerPoint?',
        a: 'No. PowerPoint files use @mdgate/pptx.',
      },
    ],
    related: ['pptx', 'pages', 'numbers', 'pdf', 'odp', 'ppt'],
  },
  {
    pkg: 'wps',
    extensions: ['wps', 'wpt', 'et', 'ett', 'dps', 'dpt'],
    parse: 'WPS package parsing',
    structure: 'Office-compatible parts · readable strings',
    extracts: [
      'Office-compatible OOXML or OLE packages via the matching Word, Excel, or PowerPoint converter',
      'Readable strings from proprietary Kingsoft ZIP parts or OLE streams',
      'Duplicate runs removed',
      'Encrypted Office-compatible package detection',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers: 'Parse WPS files directly inside Workers without WPS Office or a native binary.',
    browser: 'Convert {name} locally without uploading it to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    extraFaq: [
      {
        q: 'Does it reconstruct full WPS layout?',
        a: 'Office-compatible packages follow the official converters. Proprietary Kingsoft packages are best-effort text.',
      },
    ],
    related: ['docx', 'xlsx', 'pptx', 'pdf', 'doc', 'odt'],
  },
  {
    pkg: 'hwp',
    extensions: ['hwp', 'hwpx', 'hwt', 'hwtx'],
    parse: 'HWP / HWPX parsing',
    structure: 'paragraphs · headings · tables',
    extracts: [
      'HWPX / HWTX paragraphs and line breaks',
      'Heading styles when present',
      'Tables in HWPX',
      'HWP 5 PARA_TEXT records when the layout is recognizable',
      'Readable UTF-16 strings and PrvText preview as a fallback',
      'Encrypted and distribution-locked document detection',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers:
      'Parse Hangul files directly inside Workers without Hangul Word Processor or a native binary.',
    browser: 'Convert {name} locally without uploading it to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    extraFaq: [
      {
        q: 'Is binary HWP fully reconstructed?',
        a: 'No. The converter prefers structured text when it can find it, and falls back to extracted strings rather than pretending it has a full HWP renderer.',
      },
    ],
    related: ['docx', 'pdf', 'pages', 'rtf', 'html', 'odt'],
  },
  {
    pkg: 'pdf',
    extensions: ['pdf'],
    parse: 'deterministic parsing',
    structure: 'reading order · text · tables · structure',
    extracts: [
      'Page reading order',
      'Positioned text',
      'Common font encodings',
      'Embedded character maps',
      'CJK text',
      'Superscript and subscript',
      'Table-like layouts',
      'Duplicate and overlapping text',
      'Encrypted PDF detection',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers: 'Parse PDFs directly inside Workers without a Python service or native binary.',
    browser: 'Convert text-based PDFs locally without uploading them to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    split: {
      leftTitle: 'Text-based PDF',
      left: 'PDF text → @mdgate/pdf → Markdown',
      rightTitle: 'Scanned / image-heavy PDF',
      right: 'PDF images → your image / vision pipeline',
      note: '@mdgate/pdf does not silently send PDFs to an OCR or AI service.',
    },
    extraFaq: [
      {
        q: 'Does it support scanned PDFs?',
        a: '@mdgate/pdf deterministically parses textual PDF content. Text visible only inside scanned images requires an image or vision pipeline.',
      },
    ],
    related: ['docx', 'pptx', 'xlsx', 'hwp', 'pages', 'msg'],
  },
  {
    pkg: 'html',
    extensions: ['html', 'htm', 'html4', 'html5', 'xhtml', 'mhtml', 'mht'],
    parse: 'HTML tree parsing',
    structure: 'headings · lists · tables · links',
    extracts: [
      'Headings, paragraphs, and block quotes',
      'Bold, italic, strikethrough, and inline code',
      'Links and relative URLs',
      'Ordered, unordered, and nested lists',
      'Tables, including spanning cells',
      'Code blocks',
      'MHTML / MHT archives',
      'XHTML',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers: 'Parse HTML directly inside Workers without a browser engine or native binary.',
    browser: 'Convert {name} locally without uploading it to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    related: ['eml', 'epub', 'docx', 'pdf', 'ipynb', 'txt'],
  },
  {
    pkg: 'email',
    extensions: ['eml', 'msg', 'mbox', 'emlx'],
    parse: 'MIME / MSG parsing',
    structure: 'headers · body · attachments',
    extracts: [
      'Subject as a heading',
      'From, To, Cc, and Date',
      'HTML bodies converted through the HTML document model',
      'Plain-text bodies',
      'Attachment names under an Attachments heading',
      'Outlook .msg compound files',
    ],
    node: 'Read local files, uploads, S3/R2 objects, IMAP exports, and other byte sources.',
    workers: 'Parse {name} files directly inside Workers without an email client.',
    browser: 'Convert {name} files locally without uploading them to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    related: ['html', 'docx', 'pdf', 'zip', 'txt', 'eml'],
  },
  {
    pkg: 'ipynb',
    extensions: ['ipynb'],
    parse: 'nbformat parsing',
    structure: 'markdown cells · code cells · outputs',
    extracts: [
      'Markdown cells as Markdown',
      'Code cells as fenced code blocks',
      'Cell outputs that can be represented as text',
      'Cell order',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers: 'Parse notebooks directly inside Workers without Jupyter or a Python kernel.',
    browser: 'Convert {name} locally without uploading it to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    related: ['html', 'tex', 'txt', 'pdf', 'docx', 'json'],
  },
  {
    pkg: 'epub',
    extensions: ['epub', 'ibooks'],
    parse: 'package and spine parsing',
    structure: 'chapters · headings · links',
    extracts: [
      'Spine order',
      'Chapter HTML as Markdown',
      'Headings, paragraphs, lists, links, and tables',
      'iBooks packages that use the same ZIP + HTML shape',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers: 'Parse EPUB files directly inside Workers without an ebook reader or native binary.',
    browser: 'Convert {name} locally without uploading it to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    related: ['fb2', 'mobi', 'html', 'pdf', 'docx', 'txt'],
  },
  {
    pkg: 'fb2',
    extensions: ['fb2', 'fb2.zip'],
    parse: 'FictionBook XML parsing',
    structure: 'title · body · headings',
    extracts: [
      'Title and body sections',
      'Headings and paragraphs',
      'Emphasis',
      'Nested ZIP (.fb2.zip)',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers: 'Parse FB2 files directly inside Workers without an ebook reader or native binary.',
    browser: 'Convert {name} locally without uploading it to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    related: ['epub', 'mobi', 'html', 'pdf', 'txt', 'docx'],
  },
  {
    pkg: 'mobi',
    extensions: ['mobi', 'azw', 'azw3', 'prc'],
    parse: 'PalmDOC / MOBI parsing',
    structure: 'text records · KF8 HTML',
    extracts: [
      'Uncompressed PalmDOC',
      'PalmDOC LZ77',
      'HUFF/CDIC compression',
      'KF8/AZW3 XHTML when it can be isolated',
      'DRM-encrypted book detection',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers:
      'Parse MOBI and AZW files directly inside Workers without Kindle software or a native binary.',
    browser: 'Convert {name} locally without uploading it to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    extraFaq: [
      {
        q: 'Does it extract images and a table of contents?',
        a: 'No. Images, fonts, audio, NCX indexes, and Topaz (TPZ) files are not extracted. Some AZW3 books lose structure.',
      },
    ],
    related: ['epub', 'fb2', 'html', 'pdf', 'txt', 'docx'],
  },
  {
    pkg: 'latex',
    extensions: ['tex', 'latex', 'ltx'],
    parse: 'LaTeX command parsing',
    structure: 'sections · lists · tables',
    extracts: [
      '\\section and related headings',
      'Paragraphs',
      'Bold, italic, and inline code',
      'Lists',
      'Tables from common tabular markup',
      'Footnotes when present',
      'Preamble commands such as \\documentclass dropped',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers: 'Parse LaTeX directly inside Workers without TeX Live or a native binary.',
    browser: 'Convert {name} locally without uploading it to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    related: ['pdf', 'html', 'ipynb', 'txt', 'docx', 'rtf'],
  },
  {
    pkg: 'visio',
    extensions: ['vsd', 'vsdx', 'vss', 'vst', 'vssx', 'vstx'],
    parse: 'shape text parsing',
    structure: 'pages · shapes · labels',
    extracts: [
      'Readable text from VSDX ZIP packages',
      'Readable text from binary VSD OLE files',
      'Shape and page text, not a visual render of the diagram',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers: 'Parse Visio files directly inside Workers without Visio or a native binary.',
    browser: 'Convert {name} locally without uploading it to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    extraFaq: [
      {
        q: 'Does it render the diagram?',
        a: 'No. It extracts readable text from shapes and pages.',
      },
    ],
    related: ['pptx', 'pdf', 'docx', 'odg', 'html', 'one'],
  },
  {
    pkg: 'onenote',
    extensions: ['one', 'onetoc2', 'onepkg'],
    parse: 'OneNote stream parsing',
    structure: 'page titles · body lines',
    extracts: [
      'Page titles when they can be recognized',
      'Readable body lines from OLE streams or packed bytes',
      '.onepkg ZIP members passed back through the same reader when composed with create()',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers: 'Parse OneNote files directly inside Workers without OneNote or a native binary.',
    browser: 'Convert {name} locally without uploading it to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    extraFaq: [
      {
        q: 'Does it reconstruct ink and layout?',
        a: 'No. This is best-effort text extraction, not a full OneNote renderer.',
      },
    ],
    related: ['docx', 'pdf', 'html', 'msg', 'pages', 'rtf'],
  },
  {
    pkg: 'csv',
    extensions: ['csv', 'tsv', 'tab'],
    parse: 'delimited-text parsing',
    structure: 'rows · columns · tables',
    extracts: [
      'Quoted fields',
      'Comma, semicolon, and tab delimiters',
      'UTF-8 and UTF-16',
      '.csv, .tsv, and .tab',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers: 'Parse CSV and TSV directly inside Workers without a spreadsheet engine.',
    browser: 'Convert {name} locally without uploading it to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    sniff:
      '{name} has no strong file signature. Supply a path hint such as report.{name} when composing converters.',
    extraFaq: [
      {
        q: 'Does it convert Excel workbooks?',
        a: 'No. Use @mdgate/xlsx for .xlsx and .xls.',
      },
      {
        q: 'Why pass a path?',
        a: 'Delimited text is signature-less. path is a sniff hint only. The converter never reads that path from disk.',
      },
    ],
    related: ['xlsx', 'json', 'numbers', 'ods', 'txt', 'pdf'],
  },
  {
    pkg: 'data',
    extensions: ['json', 'jsonl', 'xml', 'yaml', 'yml'],
    parse: 'structured-data parsing',
    structure: 'objects · arrays · nested text',
    extracts: [
      'JSON objects and arrays as nested Markdown structure',
      'JSONL as one record after another',
      'YAML mappings and sequences',
      'XML as nested headings and text',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers: 'Parse JSON, JSONL, YAML, and XML directly inside Workers.',
    browser: 'Convert {name} locally without uploading it to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    extraFaq: [
      {
        q: 'Does XML need a path hint?',
        a: 'Yes when composed with other converters. Flat ODF and many office parts start with <?xml, so XML needs a .xml path hint.',
      },
    ],
    related: ['csv', 'txt', 'html', 'ipynb', 'pdf', 'docx'],
  },
  {
    pkg: 'text',
    extensions: [
      'txt',
      'text',
      'md',
      'markdown',
      'mdx',
      'js',
      'jsx',
      'ts',
      'tsx',
      'py',
      'rb',
      'go',
      'rs',
      'java',
      'kt',
      'c',
      'h',
      'cc',
      'cpp',
      'cs',
      'swift',
      'sh',
      'bash',
      'zsh',
      'sql',
      'css',
      'scss',
      'less',
      'graphql',
    ],
    parse: 'plain-text handling',
    structure: 'paragraphs · Markdown · code fences',
    extracts: [
      '.txt / .text: paragraphs',
      '.md / .markdown / .mdx: passed through as Markdown',
      'Source extensions: wrapped in a fenced code block',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers: 'Normalize text files directly inside Workers without a second parser.',
    browser: 'Convert {name} locally without uploading it to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    extraFaq: [
      {
        q: 'Why pass a path?',
        a: 'The path selects treatment (paragraphs, pass-through Markdown, or a code fence). It is never used to read a file from disk.',
      },
    ],
    related: ['html', 'json', 'csv', 'tex', 'ipynb', 'pdf'],
  },
  {
    pkg: 'subtitle',
    extensions: [
      'srt',
      'vtt',
      'webvtt',
      'ass',
      'ssa',
      'lrc',
      'sub',
      'sbv',
      'ttml',
      'jss',
      'jacosub',
    ],
    parse: 'cue parsing',
    structure: 'timing · text · emphasis',
    extracts: [
      'SRT and WebVTT timing',
      'ASS / SSA dialogue lines',
      'LRC lyrics',
      'MicroDVD .sub',
      'YouTube .sbv',
      'TTML',
      'Jacosub .jss',
      'Italic and other simple emphasis when the format carries it',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers: 'Parse subtitle files directly inside Workers without a media player.',
    browser: 'Convert {name} locally without uploading it to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    related: ['mp4', 'mp3', 'txt', 'html', 'pdf', 'ipynb'],
  },
  {
    pkg: 'zip',
    extensions: ['zip', 'zipx', 'jar'],
    parse: 'archive listing',
    structure: 'members · nested converters',
    extracts: [
      'Member names as Markdown when used alone',
      'Each member handed back to the same converter registry inside create()',
      'Nested archives and attachments converted by the matching format package',
      'Encrypted member detection',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers: 'Open ZIP archives directly inside Workers without unzip or a native binary.',
    browser: 'Inspect {name} files locally without uploading them to a server.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    extraFaq: [
      {
        q: 'Does it steal Office or EPUB files?',
        a: 'No. Office, ODF, EPUB, and iWork packages are also ZIP files. Those converters win on sniff score.',
      },
    ],
    related: ['eml', 'docx', 'pdf', 'epub', 'html', 'json'],
  },
  {
    pkg: 'image',
    extensions: [
      'svg',
      'svgz',
      'jpeg',
      'jpg',
      'png',
      'webp',
      'gif',
      'tiff',
      'tif',
      'heic',
      'heif',
      'bmp',
    ],
    parse: 'image detection',
    structure: 'SVG text · your vision callback',
    extracts: [
      'SVG / SVGZ titles and visible text',
      'JPEG, PNG, WebP, GIF, TIFF, HEIC, and BMP via your callback',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers:
      'Detect images inside Workers. SVG converts locally. Raster images use the callback you register.',
    browser: 'Convert SVG locally. Raster images need a vision callback in your application.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    split: {
      leftTitle: 'SVG',
      left: 'SVG text → @mdgate/image → Markdown',
      rightTitle: 'Raster image',
      right: 'JPEG / PNG / … → your vision pipeline',
      note: '@mdgate/image does not silently send images to an OCR or AI service.',
    },
    snippet: 'svg',
    extraFaq: [
      {
        q: 'Does it OCR scanned images?',
        a: 'Not by itself. Raster formats need a vision callback you provide. SVG converts locally.',
      },
    ],
    related: ['pdf', 'mp3', 'mp4', 'html', 'docx', 'srt'],
  },
  {
    pkg: 'audio',
    extensions: ['mp3', 'wav', 'wave', 'm4a', 'aac', 'ogg', 'flac', 'weba'],
    parse: 'audio detection',
    structure: 'your transcription callback',
    extracts: [
      'MP3, WAV, M4A, AAC, Ogg, FLAC, and WebM audio detection',
      'The whole file passed to your transcription callback',
      'No decode or resample inside mdgate',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers: 'Detect audio inside Workers, then call the transcription function you register.',
    browser:
      'Files stay in the browser. Transcription still needs the callback your application provides.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    split: {
      leftTitle: 'Detection',
      left: 'audio bytes → @mdgate/audio',
      rightTitle: 'Transcription',
      right: 'your speech model → Markdown',
      note: '@mdgate/audio does not silently send audio to a transcription service.',
    },
    snippet: 'callback',
    local: false,
    extraFaq: [
      {
        q: 'Does it transcribe audio in the browser demo?',
        a: 'No. audio() is not in all(). Connect the speech model your application already uses.',
      },
    ],
    related: ['srt', 'mp4', 'jpeg', 'pdf', 'msg', 'txt'],
  },
  {
    pkg: 'video',
    extensions: ['mp4', 'm4v', 'mov', 'qt', 'webm', 'mkv', 'mk3d', 'avi'],
    parse: 'video detection',
    structure: 'your video callback',
    extracts: [
      'MP4, M4V, MOV, WebM, Matroska, and AVI detection',
      'The whole file passed to your callback',
      'No decode, transcode, or frame extraction inside mdgate',
    ],
    node: 'Read local files, uploads, S3/R2 objects, and other byte sources.',
    workers: 'Detect video inside Workers, then call the function you register.',
    browser:
      'Files stay in the browser. Video understanding still needs the callback your application provides.',
    edge: 'Run the same TypeScript converter in compatible Edge runtimes.',
    split: {
      leftTitle: 'Detection',
      left: 'video bytes → @mdgate/video',
      rightTitle: 'Understanding',
      right: 'your video model → Markdown',
      note: '@mdgate/video does not silently send video to a model.',
    },
    snippet: 'callback',
    local: false,
    extraFaq: [
      {
        q: 'Does it caption video in the browser demo?',
        a: 'No. video() is not in all(). Connect the video model your application already uses.',
      },
    ],
    related: ['srt', 'mp3', 'jpeg', 'pdf', 'html', 'txt'],
  },
];

function expand(family: Family): ConverterPage[] {
  return family.extensions.map((ext) => {
    const name = displayName(ext);
    const svg = ext === 'svg' || ext === 'svgz';
    const local = family.pkg === 'image' ? svg : (family.local ?? true);
    const snippet: ConverterPage['snippet'] =
      family.pkg === 'image' ? (svg ? 'default' : 'callback') : (family.snippet ?? 'default');
    const sniff =
      family.sniff !== undefined
        ? fill(family.sniff, ext)
        : `Recognizes ${name} files from their contents, not only the filename.`;
    const sampleFile = SAMPLES[ext];
    const acceptExt = ext.includes('.') ? `.${ext.slice(ext.lastIndexOf('.') + 1)}` : `.${ext}`;
    return {
      pkg: family.pkg,
      ext,
      slug: slugFor(ext),
      name,
      stay: `Your ${name}`,
      files: `${name} files`,
      accept: acceptExt,
      sample:
        sampleFile === undefined ? undefined : { file: sampleFile, button: `Try a sample ${name}` },
      how: {
        source: name,
        parse: family.parse,
        structure: family.structure,
      },
      extracts: family.extracts,
      runtimes: {
        node: fill(family.node, name),
        workers: fill(family.workers, name),
        browser: fill(family.browser, name),
        edge: fill(family.edge, name),
      },
      split: family.split,
      related: relatedFor(ext, family),
      faq: defaultFaq(family, name, `${name} files`, local),
      why: defaultWhy(name, sniff, local),
      snippet,
      compose: composeFor(family.pkg),
      sniff,
      local,
    };
  });
}

export const PAGES: ConverterPage[] = FAMILIES.flatMap(expand);

export const PAGE_BY_EXT = new Map(PAGES.map((page) => [page.ext, page]));

export function pageBySlug(slug: string): ConverterPage | undefined {
  return PAGES.find((page) => page.slug === slug);
}

const seen = new Set<string>();
for (const page of PAGES) {
  if (seen.has(page.ext)) throw new Error(`duplicate extension page ${page.ext}`);
  seen.add(page.ext);
  for (const related of page.related) {
    if (!PAGE_BY_EXT.has(related)) {
      throw new Error(`unknown related extension ${related} on ${page.ext}`);
    }
  }
}
