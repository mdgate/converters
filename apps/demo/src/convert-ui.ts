import { formatLabel, mediaKind, stemOf } from './format';
import { renderMarkdown } from './preview';
import { loadSample } from './samples';
import type { ConvertRequest, WorkerMessage } from './worker';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLElement)) throw new Error(`missing #${id}`);
  return el as T;
};

const MEDIA_HELP = {
  image: {
    title: 'This file needs a model callback',
    lede: '@mdgate/image does not send images to an AI service automatically. Connect the vision model your application already uses.',
    install: 'npm install @mdgate/image',
    href: 'https://github.com/mdgate/converters/tree/main/packages/image',
  },
  audio: {
    title: 'This file needs a model callback',
    lede: '@mdgate/audio does not send audio to a transcription service automatically. Connect the speech model your application already uses.',
    install: 'npm install @mdgate/audio',
    href: 'https://github.com/mdgate/converters/tree/main/packages/audio',
  },
  video: {
    title: 'This file needs a model callback',
    lede: '@mdgate/video does not send video to a model automatically. Connect the video model your application already uses.',
    install: 'npm install @mdgate/video',
    href: 'https://github.com/mdgate/converters/tree/main/packages/video',
  },
} as const;

export type ConvertUiOptions = {
  readyLabel?: string;
  copyIdle?: string;
  copyDone?: string;
  statsFor?: (info: { name: string; format: string; chars: number; ms: number }) => string;
};

export function bindConvert(options: ConvertUiOptions = {}): void {
  const readyLabel = options.readyLabel ?? 'Ready · running @mdgate/converters locally';
  const copyIdle = options.copyIdle ?? 'Copy';
  const copyDone = options.copyDone ?? 'Copied';
  const statsFor =
    options.statsFor ??
    ((info) => `${info.format} · ${info.chars.toLocaleString('en-US')} chars · ${info.ms} ms`);

  const drop = $<HTMLButtonElement>('drop');
  const statusEl = $('status');
  const statusLabel = $('status-label');
  const fileInput = $<HTMLInputElement>('file');
  const output = $('output');
  const preview = $('preview');
  const help = $('help');
  const helpTitle = $('help-title');
  const helpLede = $('help-lede');
  const helpBody = $('help-body');
  const helpCmd = $('help-cmd');
  const helpLink = $<HTMLAnchorElement>('help-link');
  const result = $('result');
  const resultName = $('result-name');
  const resultArrow = $('result-arrow');
  const resultStats = $('result-stats');
  const view = $('view');
  const viewPreview = $<HTMLButtonElement>('view-preview');
  const viewSource = $<HTMLButtonElement>('view-source');
  const copyBtn = $<HTMLButtonElement>('copy');
  const downloadBtn = $<HTMLButtonElement>('download');
  const sampleButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-sample]')];

  let markdown = '';
  let baseName = 'document';
  let seq = 0;
  let ready = false;
  let showPreview = true;

  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

  worker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
    if (event.data.type !== 'ready') return;
    ready = true;
    setBusy(false);
  });

  worker.addEventListener('error', (event) => {
    statusEl.classList.remove('ready', 'busy');
    statusLabel.textContent = event.message || 'The converter failed to load';
    drop.disabled = true;
  });

  function setStatus(kind: 'starting' | 'ready' | 'busy', label: string): void {
    statusEl.classList.toggle('ready', kind === 'ready');
    statusEl.classList.toggle('busy', kind === 'busy');
    statusLabel.textContent = label;
  }

  function setBusy(busy: boolean, label?: string): void {
    drop.disabled = busy || !ready;
    for (const button of sampleButtons) button.disabled = busy || !ready;
    if (busy) {
      setStatus('busy', label ?? 'Converting');
      return;
    }
    if (ready) {
      setStatus('ready', readyLabel);
    }
  }

  function applyView(): void {
    const previewOn = showPreview && !output.classList.contains('error') && help.hidden;
    preview.hidden = !previewOn;
    output.hidden = previewOn || !help.hidden;
    viewPreview.setAttribute('aria-pressed', previewOn ? 'true' : 'false');
    viewSource.setAttribute('aria-pressed', previewOn ? 'false' : 'true');
  }

  function hideHelp(): void {
    help.hidden = true;
  }

  function showMediaHelp(kind: keyof typeof MEDIA_HELP): void {
    const info = MEDIA_HELP[kind];
    help.hidden = false;
    helpTitle.textContent = info.title;
    helpLede.textContent = info.lede;
    helpBody.textContent =
      'SVG converts locally. Raster images, audio, and video stay out of all() until you register a callback.';
    helpCmd.textContent = info.install;
    helpLink.href = info.href;
    preview.replaceChildren();
    preview.hidden = true;
    output.hidden = true;
    view.hidden = true;
    copyBtn.hidden = true;
    downloadBtn.hidden = true;
  }

  function showResult(name: string, stats: string, text: string, isError: boolean): void {
    hideHelp();
    result.hidden = false;
    resultName.textContent = name;
    resultArrow.hidden = isError;
    resultStats.textContent = isError ? '' : stats;
    copyBtn.hidden = isError;
    downloadBtn.hidden = isError;
    view.hidden = isError;
    output.textContent = text;
    output.classList.toggle('error', isError);
    if (isError) {
      preview.replaceChildren();
    } else {
      preview.innerHTML = renderMarkdown(text);
    }
    applyView();
    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function convert(name: string, bytes: Uint8Array): void {
    if (!ready) return;
    const id = ++seq;
    const format = formatLabel(name, bytes);
    const media = mediaKind(name, bytes);
    baseName = stemOf(name);
    setBusy(true, `Converting ${name}`);

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
        showResult(
          name,
          statsFor({ name, format, chars: markdown.length, ms: msg.ms }),
          markdown,
          false,
        );
        return;
      }
      if (media !== undefined) {
        result.hidden = false;
        resultName.textContent = name;
        resultArrow.hidden = true;
        resultStats.textContent = '';
        showMediaHelp(media);
        result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

  for (const button of sampleButtons) {
    button.addEventListener('click', () => {
      const name = button.dataset.sample;
      if (name === undefined) return;
      void loadSample(name)
        .then((bytes) => convert(name, bytes))
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          showResult(name, '', `Could not load sample: ${message}`, true);
        });
    });
  }

  viewPreview.addEventListener('click', () => {
    showPreview = true;
    applyView();
  });

  viewSource.addEventListener('click', () => {
    showPreview = false;
    applyView();
  });

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      copyBtn.textContent = copyDone;
    } catch {
      copyBtn.textContent = 'Copy failed';
    }
    window.setTimeout(() => {
      copyBtn.textContent = copyIdle;
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
}
