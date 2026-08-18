import { setPdfMaps, toMarkdown } from '@mdgate/converters';
import mapsUrl from '@mdgate/pdf/maps.bin?url';

export type ConvertRequest = {
  type: 'convert';
  id: number;
  path: string;
  bytes: Uint8Array;
};

export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'ok'; id: number; markdown: string; ms: number }
  | { type: 'err'; id: number; message: string };

void fetch(mapsUrl)
  .then((response) => {
    if (!response.ok) throw new Error(`maps.bin ${response.status}`);
    return response.arrayBuffer();
  })
  .then((buf) => {
    setPdfMaps(new Uint8Array(buf));
    self.postMessage({ type: 'ready' } satisfies WorkerMessage);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    self.postMessage({ type: 'err', id: -1, message } satisfies WorkerMessage);
  });

self.addEventListener('message', (event: MessageEvent<ConvertRequest>) => {
  const data = event.data;
  if (data?.type !== 'convert') return;

  const started = performance.now();
  void toMarkdown(data.bytes, { path: data.path })
    .then((markdown) => {
      const ms = Math.max(1, Math.round(performance.now() - started));
      const reply: WorkerMessage = { type: 'ok', id: data.id, markdown, ms };
      self.postMessage(reply);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const reply: WorkerMessage = { type: 'err', id: data.id, message };
      self.postMessage(reply);
    });
});
