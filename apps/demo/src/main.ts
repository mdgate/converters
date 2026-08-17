import { formatLabel, stemOf } from './format';
import { sampleCsv, sampleDocx, sampleRtf } from './samples';
import type { ConvertRequest, WorkerMessage } from './worker';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLElement)) throw new Error(`missing #${id}`);
  return el as T;
};

const drop = $<HTMLButtonElement>('drop');
const dropTitle = $('drop-title');
const dropHint = $('drop-hint');
const fileInput = $<HTMLInputElement>('file');
const output = $('output');
const result = $('result');
const resultName = $('result-name');
const resultArrow = $('result-arrow');
const resultStats = $('result-stats');
const copyBtn = $<HTMLButtonElement>('copy');
const downloadBtn = $<HTMLButtonElement>('download');
const sampleRtfBtn = $<HTMLButtonElement>('sample-rtf');
const sampleCsvBtn = $<HTMLButtonElement>('sample-csv');
const sampleDocxBtn = $<HTMLButtonElement>('sample-docx');

let markdown = '';
let baseName = 'document';
let seq = 0;
let ready = false;

const idleTitle = 'Drop a document here';
const idleHint = 'or <u>browse</u> for one. Conversion happens locally, nothing is uploaded.';

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
  if (event.data.type !== 'ready') return;
  ready = true;
  setBusy(false);
});

worker.addEventListener('error', (event) => {
  dropTitle.textContent = 'The converter failed to load';
  dropHint.textContent = event.message || 'worker error';
  drop.disabled = true;
});

function setBusy(busy: boolean, label?: string): void {
  drop.disabled = busy || !ready;
  sampleRtfBtn.disabled = busy || !ready;
  sampleCsvBtn.disabled = busy || !ready;
  sampleDocxBtn.disabled = busy || !ready;
  if (busy) {
    dropTitle.textContent = label ?? 'Converting…';
    dropHint.textContent = 'this stays on your machine';
    return;
  }
  if (ready) {
    dropTitle.textContent = idleTitle;
    dropHint.innerHTML = idleHint;
  }
}

function showResult(name: string, stats: string, text: string, isError: boolean): void {
  result.hidden = false;
  resultName.textContent = name;
  resultArrow.hidden = isError;
  resultStats.textContent = isError ? '' : stats;
  copyBtn.hidden = isError;
  downloadBtn.hidden = isError;
  output.textContent = text;
  output.classList.toggle('error', isError);
  result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function convert(name: string, bytes: Uint8Array): void {
  if (!ready) return;
  const id = ++seq;
  const format = formatLabel(name, bytes);
  baseName = stemOf(name);
  setBusy(true, `Converting ${name}…`);

  const copy = new Uint8Array(bytes);
  const request: ConvertRequest = { type: 'convert', id, path: name, bytes: copy };
  worker.postMessage(request, [copy.buffer]);

  const onMessage = (event: MessageEvent<WorkerMessage>): void => {
    const msg = event.data;
    if (msg.type === 'ready') return;
    if (msg.id !== id) return;
    worker.removeEventListener('message', onMessage);
    if (id !== seq) return;
    setBusy(false);
    if (msg.type === 'ok') {
      markdown = msg.markdown;
      const chars = markdown.length.toLocaleString('en-US');
      showResult(name, `${format} · ${chars} chars · ${msg.ms} ms`, markdown, false);
      return;
    }
    showResult(name, '', `Could not convert this file: ${msg.message}`, true);
  };
  worker.addEventListener('message', onMessage);
}

async function convertFile(file: File): Promise<void> {
  convert(file.name, new Uint8Array(await file.arrayBuffer()));
}

drop.addEventListener('click', () => {
  if (!drop.disabled) fileInput.click();
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void convertFile(file);
  fileInput.value = '';
});

for (const eventName of ['dragover', 'drop'] as const) {
  window.addEventListener(eventName, (event) => event.preventDefault());
}

drop.addEventListener('dragover', () => drop.classList.add('over'));
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (event) => {
  drop.classList.remove('over');
  const dropped = event.dataTransfer?.files?.[0];
  if (dropped) void convertFile(dropped);
});

sampleRtfBtn.addEventListener('click', () => convert('notes.rtf', sampleRtf()));
sampleCsvBtn.addEventListener('click', () => convert('report.csv', sampleCsv()));
sampleDocxBtn.addEventListener('click', () => {
  void sampleDocx()
    .then((bytes) => convert('letter.docx', bytes))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      showResult('letter.docx', '', `Could not load sample: ${message}`, true);
    });
});

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(markdown);
    copyBtn.textContent = 'Copied';
  } catch {
    copyBtn.textContent = 'Copy failed';
  }
  window.setTimeout(() => {
    copyBtn.textContent = 'Copy';
  }, 1200);
});

downloadBtn.addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }));
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: `${baseName}.md`,
  });
  a.click();
  URL.revokeObjectURL(url);
});
