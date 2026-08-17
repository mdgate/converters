const SAMPLE_RTF = String.raw`{\rtf1\ansi\deff0{\fonttbl{\f0 Times New Roman;}}
\pard\sa200 {\b mdgate} turns office files into {\i GitHub-Flavored Markdown} in the browser.\par
\pard\sa200 Headings, lists, and tables come through the same document model, whether the source is a 2003 .doc or yesterday's .xlsx.\par
}`;

const SAMPLE_CSV = `format,family,notes
docx,office,WordprocessingML
xlsx,office,workbook
pdf,pdf,text-based pages
epub,office,EPUB 2 and 3
`;

export function sampleRtf(): Uint8Array {
  return new TextEncoder().encode(SAMPLE_RTF);
}

export function sampleCsv(): Uint8Array {
  return new TextEncoder().encode(SAMPLE_CSV);
}

export async function sampleDocx(): Promise<Uint8Array> {
  const res = await fetch('/samples/letter.docx');
  if (!res.ok) {
    throw new Error(`could not load sample (${res.status})`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
