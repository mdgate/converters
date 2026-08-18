const SAMPLE_RTF = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Times New Roman;}}
\pard\sa200 {\b mdgate} turns office files into {\i GitHub-Flavored Markdown} in the browser.\par
\pard\sa200 Headings, lists, and tables come through the same Markdown dialect, whether the source is a 2003 .doc or yesterday's .xlsx.\par
}`;

const SAMPLE_CSV = `format,family,notes
docx,office,WordprocessingML
html,web,saved pages
eml,mail,RFC 822
ipynb,notebook,Jupyter
pdf,pdf,text and embedded images
`;

const SAMPLE_HTML = `<!doctype html>
<html lang="en">
  <body>
    <h1>mdgate</h1>
    <p>Turn <strong>any file</strong> into <em>GitHub-Flavored Markdown</em>.</p>
    <ul>
      <li>Office, iWork, and OpenDocument</li>
      <li>HTML, email, and notebooks</li>
      <li>Ebooks, audio, video, and ZIP archives</li>
    </ul>
  </body>
</html>
`;

const SAMPLE_EML = `From: demo@mdgate.dev
To: you@example.com
Subject: Any file to Markdown
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8

mdgate converts office files, HTML, email, notebooks, audio, and video
in the browser. Nothing is uploaded.
`;

async function fetchSample(path: string): Promise<Uint8Array> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`could not load sample (${res.status})`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

export function sampleRtf(): Uint8Array {
  return new TextEncoder().encode(SAMPLE_RTF);
}

export function sampleCsv(): Uint8Array {
  return new TextEncoder().encode(SAMPLE_CSV);
}

export function sampleHtml(): Uint8Array {
  return new TextEncoder().encode(SAMPLE_HTML);
}

export function sampleEml(): Uint8Array {
  return new TextEncoder().encode(SAMPLE_EML);
}

export function sampleDocx(): Promise<Uint8Array> {
  return fetchSample('/samples/letter.docx');
}

export function sampleXlsx(): Promise<Uint8Array> {
  return fetchSample('/samples/sheet.xlsx');
}
