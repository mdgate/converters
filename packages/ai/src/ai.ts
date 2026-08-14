import { type Ai, type AiImage, type AiImageMime, ConvertError } from '@mdgate/core';

export type AiConfig = {
  baseURL: string;
  apiKey: string;
  model: string;
};

const MIMES = new Set<AiImageMime>(['image/jpeg', 'image/png', 'image/webp']);

const SYSTEM_PROMPT = [
  'You convert a document image into GitHub-Flavored Markdown.',
  'Transcribe all readable text exactly, in reading order.',
  'Preserve structure: headings, paragraphs, lists, tables, block quotes, and code.',
  'Use GFM tables when the image shows a table.',
  'Describe charts, diagrams, stamps, signatures, and photos only when they carry meaning.',
  'Do not mention that the source is an image.',
  'Do not wrap the entire answer in a markdown code fence.',
  'Do not add a preamble or postscript.',
].join(' ');

/**
 * Build an `Ai` that talks to an OpenAI-compatible chat/completions endpoint.
 * `baseURL`, `apiKey`, and `model` are required — there is no default provider.
 */
export function ai(config: AiConfig): Ai {
  const baseURL = requireField('baseURL', config.baseURL).replace(/\/+$/, '');
  const apiKey = requireField('apiKey', config.apiKey);
  const model = requireField('model', config.model);

  return {
    async readImage(image: AiImage): Promise<string> {
      return readImage({ baseURL, apiKey, model }, image);
    },
  };
}

async function readImage(config: Required<AiConfig>, image: AiImage): Promise<string> {
  if (!(image.bytes instanceof Uint8Array) || image.bytes.length === 0) {
    throw ConvertError.ai('image bytes are required');
  }
  if (!MIMES.has(image.mime)) {
    throw ConvertError.ai(`unsupported image mime: ${String(image.mime)}`);
  }

  const userText =
    image.page === undefined
      ? 'Extract the content of this document image as markdown.'
      : `Extract page ${image.page} of this document as markdown.`;

  let response: Response;
  try {
    response = await fetch(`${config.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: userText },
              {
                type: 'image_url',
                image_url: { url: `data:${image.mime};base64,${bytesToBase64(image.bytes)}` },
              },
            ],
          },
        ],
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw ConvertError.ai(msg);
  }

  const raw = await response.text();
  if (!response.ok) {
    throw ConvertError.ai(`HTTP ${response.status}: ${clip(raw)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw ConvertError.ai('model response is not JSON');
  }

  const text = unwrapMarkdown(contentFromResponse(parsed));
  if (text.length === 0) {
    throw ConvertError.ai('empty model response');
  }
  return text.endsWith('\n') ? text : `${text}\n`;
}

function requireField(name: string, value: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw ConvertError.ai(`${name} is required`);
  }
  return value.trim();
}

function contentFromResponse(parsed: unknown): string {
  if (typeof parsed !== 'object' || parsed === null || !('choices' in parsed)) {
    throw ConvertError.ai('model response is missing choices');
  }
  const choices = (parsed as { choices: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw ConvertError.ai('model response is missing choices');
  }
  const message = (choices[0] as { message?: { content?: unknown }; text?: unknown } | undefined)
    ?.message;
  const content = message?.content ?? (choices[0] as { text?: unknown } | undefined)?.text;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part === 'object' && part !== null && 'text' in part) {
          return typeof (part as { text: unknown }).text === 'string'
            ? (part as { text: string }).text
            : '';
        }
        return '';
      })
      .join('');
  }
  throw ConvertError.ai('model response has no text content');
}

function unwrapMarkdown(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return (fenced ? fenced[1]! : trimmed).trim();
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function clip(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 240 ? `${t.slice(0, 237)}...` : t;
}
