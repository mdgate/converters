#!/usr/bin/env node
/**
 * One-off stage profiler. Imports mdgate internals from dist/.
 * Does not change src/. Warmup 2, then N=10 medians in one warm process.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatFromBytes, formatFromPath } from '../../dist/internal/detect.js';
import { parse, pdfToMarkdown } from '../../dist/internal/formats/index.js';
import { destinationGroups, Lexer } from '../../dist/internal/formats/rtf/lexer.js';
import { parseXlsCfb } from '../../dist/internal/formats/sheet/xls.js';
import { Package } from '../../dist/internal/package/archive.js';
import { CompoundFile, hasOleMagic } from '../../dist/internal/package/cfb.js';
import { parseXml } from '../../dist/internal/package/xml.js';
import { documentToMarkdown } from '../../dist/internal/render/index.js';

const FIXTURE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const WARMUP = 2;
const N = 10;
const REPS = [
  'docx/text.docx',
  'rtf/text.rtf',
  'rtf/handmade-cocoa.rtf',
  'xls/sheet.xls',
  'ods/handmade-gaps.ods',
  'pdf/text.pdf',
  'csv/sheet.csv',
];

function now() {
  return process.hrtime.bigint();
}

function nsToMs(ns) {
  return Number(ns) / 1e6;
}

function median(xs) {
  if (xs.length === 0) return NaN;
  const a = xs.slice().sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 === 1 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function fmt(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (Math.abs(ms) < 0.00005) return '0.0000';
  return ms.toFixed(4);
}

function pct(part, whole) {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return '—';
  return `${((100 * part) / whole).toFixed(1)}%`;
}

function isZipBytes(bytes) {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

function looksLikeXml(bytes) {
  if (bytes === undefined || bytes.length === 0) return false;
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return true;
  else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return true;
  while (i < bytes.length) {
    const c = bytes[i];
    if (c === 32 || c === 9 || c === 10 || c === 13) {
      i += 1;
      continue;
    }
    return c === 60;
  }
  return false;
}

function walkFiles(dir, out) {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'abuse') continue;
      walkFiles(path, out);
    } else if (entry.isFile()) {
      if (entry.name.includes('--errors')) continue;
      out.push(path);
    }
  }
}

function collectZipParts(bytes, format) {
  const names = [];
  const orig = Package.prototype.part;
  Package.prototype.part = function partHook(name) {
    names.push(name);
    return orig.call(this, name);
  };
  try {
    parse(bytes, format);
  } finally {
    Package.prototype.part = orig;
  }
  return [...new Set(names)];
}

function drainRtfLexer(bytes) {
  const lexer = new Lexer(bytes);
  let n = 0;
  for (;;) {
    const tok = lexer.nextToken();
    if (tok === undefined) break;
    n += 1;
  }
  return n;
}

function preludeDestGroups(bytes) {
  destinationGroups(bytes, 'fonttbl');
  destinationGroups(bytes, 'stylesheet');
  destinationGroups(bytes, 'listtable');
  destinationGroups(bytes, 'listoverridetable');
}

function instrumentedParse(bytes, format) {
  const acc = { openNs: 0n, inflateNs: 0n, xmlNs: 0n };
  const origOpen = Package.open;
  const origPart = Package.prototype.part;
  const origReqXml = Package.prototype.requiredXmlPart;
  const origOptXml = Package.prototype.optionalXmlPart;

  Package.open = function openHook(buf) {
    const t = now();
    try {
      return origOpen.call(this, buf);
    } finally {
      acc.openNs += now() - t;
    }
  };
  Package.prototype.part = function partHook(name) {
    const t = now();
    try {
      return origPart.call(this, name);
    } finally {
      acc.inflateNs += now() - t;
    }
  };
  Package.prototype.requiredXmlPart = function reqXmlHook(name) {
    const partBytes = this.requiredPart(name);
    const t = now();
    try {
      return parseXml(partBytes);
    } finally {
      acc.xmlNs += now() - t;
    }
  };
  Package.prototype.optionalXmlPart = function optXmlHook(name) {
    let partBytes;
    try {
      partBytes = this.optionalPart(name);
    } catch {
      return undefined;
    }
    if (partBytes === undefined) return undefined;
    const t = now();
    try {
      return parseXml(partBytes);
    } catch (e) {
      acc.xmlNs += now() - t;
      return undefined;
    } finally {
      acc.xmlNs += 0n;
    }
  };
  // Fix optionalXml: count time once in finally only.
  Package.prototype.optionalXmlPart = function optXmlHook(name) {
    let partBytes;
    try {
      partBytes = this.optionalPart(name);
    } catch {
      return undefined;
    }
    if (partBytes === undefined) return undefined;
    const t = now();
    try {
      return parseXml(partBytes);
    } catch {
      return undefined;
    } finally {
      acc.xmlNs += now() - t;
    }
  };

  try {
    const t = now();
    const doc = parse(bytes, format);
    const parseNs = now() - t;
    return {
      parseNs,
      openNs: acc.openNs,
      inflateNs: acc.inflateNs,
      xmlNs: acc.xmlNs,
      walkNs: parseNs - acc.openNs - acc.inflateNs - acc.xmlNs,
      doc,
    };
  } finally {
    Package.open = origOpen;
    Package.prototype.part = origPart;
    Package.prototype.requiredXmlPart = origReqXml;
    Package.prototype.optionalXmlPart = origOptXml;
  }
}

function timeZipRemesure(bytes, partNames) {
  const t0 = now();
  const pkg = Package.open(bytes);
  const t1 = now();
  const inflated = [];
  for (const name of partNames) {
    inflated.push(pkg.part(name));
  }
  const t2 = now();
  let xmlParts = 0;
  let xmlBytes = 0;
  for (const part of inflated) {
    if (!looksLikeXml(part)) continue;
    xmlParts += 1;
    xmlBytes += part.length;
    parseXml(part);
  }
  const t3 = now();
  return {
    openNs: t1 - t0,
    inflateNs: t2 - t1,
    xmlNs: t3 - t2,
    xmlParts,
    xmlBytes,
    partCount: partNames.length,
  };
}

function profileFile(absPath, rel) {
  const size = statSync(absPath).size;
  const bytes0 = readFileSync(absPath);
  const format0 = formatFromBytes(bytes0) ?? formatFromPath(absPath);
  if (format0 === undefined) {
    throw new Error(`unrecognized fixture: ${rel}`);
  }
  const zip = isZipBytes(bytes0) && format0 !== 'pdf';
  const rtf =
    format0 === 'rtf' ||
    (format0 === 'doc' && bytes0.length >= 5 && bytes0[0] === 123 && bytes0[1] === 92);
  const ole = hasOleMagic(bytes0) && !rtf;
  const pdf = format0 === 'pdf';

  let zipPartNames = [];
  if (zip) {
    zipPartNames = collectZipParts(bytes0, format0);
  }

  // Warmup 2 of the real pipeline (and extras once).
  for (let i = 0; i < WARMUP; i += 1) {
    const bytes = readFileSync(absPath);
    const format = formatFromBytes(bytes) ?? formatFromPath(absPath);
    if (format === 'pdf') {
      pdfToMarkdown(bytes);
    } else {
      documentToMarkdown(parse(bytes, format));
    }
    if (zip) timeZipRemesure(bytes, zipPartNames);
    if (rtf) {
      drainRtfLexer(bytes);
      preludeDestGroups(bytes);
    }
    if (ole) {
      const cfb = CompoundFile.open(bytes);
      if (format === 'excel') parseXlsCfb(cfb);
    }
    if (zip) instrumentedParse(bytes, format);
  }

  const readNs = [];
  const detectNs = [];
  const detectBytesNs = [];
  const parseNs = [];
  const renderNs = [];
  const e2eNs = [];
  const zipOpenNs = [];
  const zipInflateNs = [];
  const zipXmlNs = [];
  const zipHookOpenNs = [];
  const zipHookInflateNs = [];
  const zipHookXmlNs = [];
  const zipHookWalkNs = [];
  const zipHookParseNs = [];
  const rtfLexNs = [];
  const rtfPreludeNs = [];
  const oleOpenNs = [];
  const oleXlsNs = [];
  let xmlParts = 0;
  let xmlBytes = 0;
  let partCount = zipPartNames.length;
  let rtfTokens = 0;

  for (let i = 0; i < N; i += 1) {
    const t0 = now();
    const bytes = readFileSync(absPath);
    const t1 = now();
    const fromBytes = formatFromBytes(bytes);
    const t1b = now();
    const format = fromBytes ?? formatFromPath(absPath);
    const t2 = now();
    let render = 0n;
    if (format === 'pdf') {
      pdfToMarkdown(bytes);
    } else {
      const doc = parse(bytes, format);
      const t3 = now();
      documentToMarkdown(doc);
      const t4 = now();
      render = t4 - t3;
      parseNs.push(t3 - t2);
      renderNs.push(render);
    }
    if (format === 'pdf') {
      parseNs.push(now() - t2);
      renderNs.push(0n);
    }
    readNs.push(t1 - t0);
    detectBytesNs.push(t1b - t1);
    detectNs.push(t2 - t1);
    e2eNs.push(t2 - t0 + parseNs[parseNs.length - 1] + renderNs[renderNs.length - 1]);
  }

  if (zip) {
    for (let i = 0; i < N; i += 1) {
      const z = timeZipRemesure(bytes0, zipPartNames);
      zipOpenNs.push(z.openNs);
      zipInflateNs.push(z.inflateNs);
      zipXmlNs.push(z.xmlNs);
      xmlParts = z.xmlParts;
      xmlBytes = z.xmlBytes;
      partCount = z.partCount;
    }
    for (let i = 0; i < N; i += 1) {
      const h = instrumentedParse(bytes0, format0);
      zipHookOpenNs.push(h.openNs);
      zipHookInflateNs.push(h.inflateNs);
      zipHookXmlNs.push(h.xmlNs);
      zipHookWalkNs.push(h.walkNs);
      zipHookParseNs.push(h.parseNs);
    }
  }

  if (rtf) {
    rtfTokens = drainRtfLexer(bytes0);
    for (let i = 0; i < N; i += 1) {
      const t0 = now();
      drainRtfLexer(bytes0);
      rtfLexNs.push(now() - t0);
      const t1 = now();
      preludeDestGroups(bytes0);
      rtfPreludeNs.push(now() - t1);
    }
  }

  if (ole) {
    for (let i = 0; i < N; i += 1) {
      const t0 = now();
      const cfb = CompoundFile.open(bytes0);
      oleOpenNs.push(now() - t0);
      if (format0 === 'excel') {
        const t1 = now();
        parseXlsCfb(cfb);
        oleXlsNs.push(now() - t1);
      }
    }
  }

  const read = median(readNs.map(nsToMs));
  const detect = median(detectNs.map(nsToMs));
  const detectBytes = median(detectBytesNs.map(nsToMs));
  const parseMs = median(parseNs.map(nsToMs));
  const render = median(renderNs.map(nsToMs));
  const e2e = median(e2eNs.map(nsToMs));
  const zipOpen = zip ? median(zipOpenNs.map(nsToMs)) : NaN;
  const zipInflate = zip ? median(zipInflateNs.map(nsToMs)) : NaN;
  const zipXml = zip ? median(zipXmlNs.map(nsToMs)) : NaN;
  const zipOpenInflate = zip ? zipOpen + zipInflate : NaN;
  const zipWalk = zip ? parseMs - zipOpen - zipInflate - zipXml : NaN;
  const hookOpen = zip ? median(zipHookOpenNs.map(nsToMs)) : NaN;
  const hookInflate = zip ? median(zipHookInflateNs.map(nsToMs)) : NaN;
  const hookXml = zip ? median(zipHookXmlNs.map(nsToMs)) : NaN;
  const hookWalk = zip ? median(zipHookWalkNs.map(nsToMs)) : NaN;
  const hookParse = zip ? median(zipHookParseNs.map(nsToMs)) : NaN;
  const rtfLex = rtf ? median(rtfLexNs.map(nsToMs)) : NaN;
  const rtfPrelude = rtf ? median(rtfPreludeNs.map(nsToMs)) : NaN;
  const oleOpen = ole ? median(oleOpenNs.map(nsToMs)) : NaN;
  const oleXls = ole && oleXlsNs.length ? median(oleXlsNs.map(nsToMs)) : NaN;

  return {
    rel,
    folder: rel.split('/')[0],
    format: format0,
    size,
    zip,
    rtf,
    ole,
    pdf,
    read,
    detect,
    detectBytes,
    parse: parseMs,
    render,
    e2e,
    zipOpen,
    zipInflate,
    zipXml,
    zipOpenInflate,
    zipWalk,
    hookOpen,
    hookInflate,
    hookXml,
    hookWalk,
    hookParse,
    partCount,
    xmlParts,
    xmlBytes,
    rtfLex,
    rtfPrelude,
    rtfTokens,
    oleOpen,
    oleXls,
  };
}

function folderOf(rel) {
  return rel.split('/')[0];
}

function medianField(rows, key) {
  return median(rows.map((r) => r[key]).filter((v) => Number.isFinite(v)));
}

function mdTable(headers, rows) {
  const line = (cells) => `| ${cells.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  return [line(headers), sep, ...rows.map((r) => line(r))].join('\n');
}

const files = [];
walkFiles(FIXTURE_ROOT, files);
const rows = [];
for (const abs of files) {
  const rel = relative(FIXTURE_ROOT, abs).replaceAll('\\', '/');
  const row = profileFile(abs, rel);
  rows.push(row);
  process.stderr.write(
    `${rel}  e2e=${fmt(row.e2e)} parse=${fmt(row.parse)} detect=${fmt(row.detect)} zip=${row.zip ? `${fmt(row.zipOpenInflate)}/${fmt(row.zipXml)}/${fmt(row.zipWalk)}` : 'n/a'}\n`,
  );
}

const folders = [...new Set(rows.map((r) => r.folder))];
const folderRows = folders.map((folder) => {
  const rs = rows.filter((r) => r.folder === folder);
  return {
    folder,
    n: rs.length,
    read: medianField(rs, 'read'),
    detect: medianField(rs, 'detect'),
    parse: medianField(rs, 'parse'),
    render: medianField(rs, 'render'),
    e2e: medianField(rs, 'e2e'),
    zipOpenInflate: medianField(rs, 'zipOpenInflate'),
    zipXml: medianField(rs, 'zipXml'),
    zipWalk: medianField(rs, 'zipWalk'),
    hookOpen: medianField(rs, 'hookOpen'),
    hookInflate: medianField(rs, 'hookInflate'),
    hookXml: medianField(rs, 'hookXml'),
    hookWalk: medianField(rs, 'hookWalk'),
    rtfLex: medianField(rs, 'rtfLex'),
    rtfPrelude: medianField(rs, 'rtfPrelude'),
    oleOpen: medianField(rs, 'oleOpen'),
  };
});

const overall = {
  n: rows.length,
  read: medianField(rows, 'read'),
  detect: medianField(rows, 'detect'),
  parse: medianField(rows, 'parse'),
  render: medianField(rows, 'render'),
  e2e: medianField(rows, 'e2e'),
};

const report = [];
report.push('# mdgate stage profile');
report.push('');
report.push(`Node ${process.version}, one warm process, warmup ${WARMUP}, N=${N}, median ms.`);
report.push(
  `Corpus: ${rows.length} well-formed fixtures under \`test/fixtures\` (skip \`abuse/\` and \`*--errors*\`).`,
);
report.push(
  'Pipeline matches `toMarkdown`: `readFileSync` → `formatFromBytes ?? formatFromPath` → `parse` / `pdfToMarkdown` → `documentToMarkdown`.',
);
report.push(
  'Zip sub-stages are remesured after the pipeline (new `Package.open`, inflate every part `parse` actually read, `parseXml` on XML-looking parts). `zip_walk` = `parse − open − inflate − xml` (can be slightly off across loops).',
);
report.push(
  'Hooked zip split wraps `Package.open` / `part` / `*XmlPart` inside a second `parse` loop; direct `parseXml(bytes)` calls (xlsx sheets, some charts) land in walk there.',
);
report.push('');

report.push('## Per fixture — pipeline');
report.push('');
report.push(
  mdTable(
    [
      'fixture',
      'bytes',
      'read',
      'detect',
      'parse',
      'render',
      'e2e',
      'read%',
      'detect%',
      'parse%',
      'render%',
    ],
    rows.map((r) => [
      r.rel,
      String(r.size),
      fmt(r.read),
      fmt(r.detect),
      fmt(r.parse),
      fmt(r.render),
      fmt(r.e2e),
      pct(r.read, r.e2e),
      pct(r.detect, r.e2e),
      pct(r.parse, r.e2e),
      pct(r.render, r.e2e),
    ]),
  ),
);
report.push('');

const zipRows = rows.filter((r) => r.zip);
report.push('## Per fixture — zip parse split (docx/pptx/xlsx/odt/ods/odp/epub)');
report.push('');
report.push(
  mdTable(
    [
      'fixture',
      'parts',
      'xml_parts',
      'xml_kib',
      'open',
      'inflate',
      'open+inflate',
      'parseXml',
      'walk',
      'parse',
      'inflate%',
      'xml%',
      'walk%',
    ],
    zipRows.map((r) => [
      r.rel,
      String(r.partCount),
      String(r.xmlParts),
      (r.xmlBytes / 1024).toFixed(1),
      fmt(r.zipOpen),
      fmt(r.zipInflate),
      fmt(r.zipOpenInflate),
      fmt(r.zipXml),
      fmt(r.zipWalk),
      fmt(r.parse),
      pct(r.zipInflate, r.parse),
      pct(r.zipXml, r.parse),
      pct(r.zipWalk, r.parse),
    ]),
  ),
);
report.push('');

report.push('## Per fixture — zip hooked parse (sanity)');
report.push('');
report.push(
  mdTable(
    ['fixture', 'hook_open', 'hook_inflate', 'hook_xml', 'hook_walk', 'hook_parse', 'clean_parse'],
    zipRows.map((r) => [
      r.rel,
      fmt(r.hookOpen),
      fmt(r.hookInflate),
      fmt(r.hookXml),
      fmt(r.hookWalk),
      fmt(r.hookParse),
      fmt(r.parse),
    ]),
  ),
);
report.push('');

const rtfRows = rows.filter((r) => r.rtf);
report.push('## Per fixture — RTF lexer extras');
report.push('');
report.push(
  mdTable(
    ['fixture', 'bytes', 'tokens', 'lex_once', 'prelude_4scans', 'parse', 'lex_once%', 'prelude%'],
    rtfRows.map((r) => [
      r.rel,
      String(r.size),
      String(r.rtfTokens),
      fmt(r.rtfLex),
      fmt(r.rtfPrelude),
      fmt(r.parse),
      pct(r.rtfLex, r.parse),
      pct(r.rtfPrelude, r.parse),
    ]),
  ),
);
report.push('');

const oleRows = rows.filter((r) => r.ole);
report.push('## Per fixture — OLE/CFB extras');
report.push('');
report.push(
  mdTable(
    ['fixture', 'bytes', 'cfb_open', 'xls_walk', 'parse', 'cfb%'],
    oleRows.map((r) => [
      r.rel,
      String(r.size),
      fmt(r.oleOpen),
      fmt(r.oleXls),
      fmt(r.parse),
      pct(r.oleOpen, r.parse),
    ]),
  ),
);
report.push('');

report.push('## By format folder (median of per-file medians)');
report.push('');
report.push(
  mdTable(
    [
      'folder',
      'n',
      'read',
      'detect',
      'parse',
      'render',
      'e2e',
      'zip_open+inf',
      'zip_xml',
      'zip_walk',
      'rtf_lex',
      'rtf_prelude',
      'ole_open',
    ],
    folderRows.map((r) => [
      r.folder,
      String(r.n),
      fmt(r.read),
      fmt(r.detect),
      fmt(r.parse),
      fmt(r.render),
      fmt(r.e2e),
      fmt(r.zipOpenInflate),
      fmt(r.zipXml),
      fmt(r.zipWalk),
      fmt(r.rtfLex),
      fmt(r.rtfPrelude),
      fmt(r.oleOpen),
    ]),
  ),
);
report.push('');

report.push('## Overall (median of per-file medians)');
report.push('');
report.push(
  mdTable(
    ['metric', 'ms', 'share of e2e'],
    [
      ['readFileSync', fmt(overall.read), pct(overall.read, overall.e2e)],
      ['formatFromBytes/Path', fmt(overall.detect), pct(overall.detect, overall.e2e)],
      ['parse / pdfToMarkdown', fmt(overall.parse), pct(overall.parse, overall.e2e)],
      ['documentToMarkdown', fmt(overall.render), pct(overall.render, overall.e2e)],
      ['e2e (sum of stages)', fmt(overall.e2e), '100%'],
    ],
  ),
);
report.push('');

const reps = rows.filter((r) => REPS.includes(r.rel));
report.push('## Representative files');
report.push('');
report.push(
  mdTable(
    [
      'fixture',
      'bytes',
      'read',
      'detect',
      'parse',
      'render',
      'e2e',
      'zip_open+inf',
      'zip_xml',
      'zip_walk',
      'rtf_lex',
      'rtf_prelude',
      'ole_open',
      'xls_walk',
    ],
    reps.map((r) => [
      r.rel,
      String(r.size),
      fmt(r.read),
      fmt(r.detect),
      fmt(r.parse),
      fmt(r.render),
      fmt(r.e2e),
      fmt(r.zipOpenInflate),
      fmt(r.zipXml),
      fmt(r.zipWalk),
      fmt(r.rtfLex),
      fmt(r.rtfPrelude),
      fmt(r.oleOpen),
      fmt(r.oleXls),
    ]),
  ),
);
report.push('');

report.push('## Folder stage share of parse (where split exists)');
report.push('');
const shareRows = folderRows
  .filter(
    (r) => Number.isFinite(r.zipXml) || Number.isFinite(r.rtfLex) || Number.isFinite(r.oleOpen),
  )
  .map((r) => {
    if (Number.isFinite(r.zipXml)) {
      return [
        r.folder,
        'zip',
        fmt(r.parse),
        pct(r.zipOpenInflate, r.parse),
        pct(r.zipXml, r.parse),
        pct(r.zipWalk, r.parse),
      ];
    }
    if (Number.isFinite(r.rtfLex)) {
      return [
        r.folder,
        'rtf',
        fmt(r.parse),
        pct(r.rtfLex, r.parse),
        pct(r.rtfPrelude, r.parse),
        pct(r.parse - r.rtfLex - r.rtfPrelude, r.parse),
      ];
    }
    return [
      r.folder,
      'ole',
      fmt(r.parse),
      pct(r.oleOpen, r.parse),
      '—',
      pct(r.parse - r.oleOpen, r.parse),
    ];
  });
report.push(
  mdTable(
    ['folder', 'kind', 'parse', 'open/inflate or lex or cfb', 'xml or prelude', 'walk / rest'],
    shareRows,
  ),
);

const markdown = report.join('\n') + '\n';
process.stdout.write(markdown);

const outJson = {
  node: process.version,
  warmup: WARMUP,
  n: N,
  files: rows.length,
  overall,
  folders: folderRows,
  rows,
};
writeFileSync('/tmp/mdgate-profile-stages.json', JSON.stringify(outJson, null, 2));
writeFileSync(
  '/Users/zhixunlantuabc/repos/mdgate/test/perf-scratch/profile-stages-out.md',
  markdown,
);
console.error(`wrote /tmp/mdgate-profile-stages.json (${rows.length} files)`);
