import { ConvertError } from '@mdgate/core';
import { afterEach, describe, expect, it } from 'vitest';
import { ai } from '../src/index.js';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('ai', () => {
  it('requires baseURL, apiKey, and model', () => {
    expect(() => ai({ baseURL: '', apiKey: 'k', model: 'm' })).toThrow(ConvertError);
    expect(() => ai({ baseURL: 'https://api.example.com/v1', apiKey: '  ', model: 'm' })).toThrow(
      ConvertError,
    );
    expect(() => ai({ baseURL: 'https://api.example.com/v1', apiKey: 'k', model: '' })).toThrow(
      ConvertError,
    );
    try {
      ai({ baseURL: '', apiKey: 'k', model: 'm' });
      throw new Error('expected ConvertError');
    } catch (err) {
      expect(err).toBeInstanceOf(ConvertError);
      expect((err as ConvertError).code).toBe('unsupported');
    }
  });

  it('posts an OpenAI-compatible vision request and returns markdown', async () => {
    let calls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      expect(String(input)).toBe('https://api.example.com/v1/chat/completions');
      expect(init?.method).toBe('POST');
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer secret');
      expect(headers.get('content-type')).toBe('application/json');
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        messages: Array<{
          role: string;
          content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
        }>;
      };
      expect(body.model).toBe('vision-x');
      expect(body.messages[0]?.role).toBe('system');
      expect(typeof body.messages[0]?.content).toBe('string');
      const user = body.messages[1];
      expect(user?.role).toBe('user');
      expect(Array.isArray(user?.content)).toBe(true);
      const parts = user?.content as Array<{
        type: string;
        text?: string;
        image_url?: { url: string };
      }>;
      expect(parts[0]?.text).toContain('page 3');
      expect(parts[1]?.image_url?.url.startsWith('data:image/png;base64,')).toBe(true);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '# Title\n\nHi' } }] }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }) as typeof fetch;

    const vision = ai({
      baseURL: 'https://api.example.com/v1/',
      apiKey: 'secret',
      model: 'vision-x',
    });
    await expect(vision.convertImage({ bytes: png, mime: 'image/png', page: 3 })).resolves.toBe(
      '# Title\n\nHi\n',
    );
    expect(calls).toBe(1);
  });

  it('unwraps a fenced model reply and maps HTTP failures to ConvertError.io', async () => {
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '```markdown\nHello\n```' } }] }),
        { status: 200 },
      );
    }) as typeof fetch;
    const vision = ai({
      baseURL: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'vision-x',
    });
    await expect(vision.convertImage({ bytes: png, mime: 'image/png' })).resolves.toBe('Hello\n');

    globalThis.fetch = (async () =>
      new Response('nope', { status: 401, statusText: 'Unauthorized' })) as typeof fetch;
    try {
      await vision.convertImage({ bytes: png, mime: 'image/jpeg' });
      throw new Error('expected ConvertError');
    } catch (err) {
      expect(err).toBeInstanceOf(ConvertError);
      expect((err as ConvertError).code).toBe('io');
      expect((err as ConvertError).message).toContain('HTTP 401');
    }
  });

  it('rejects empty images', async () => {
    const vision = ai({
      baseURL: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'vision-x',
    });
    await expect(
      vision.convertImage({ bytes: new Uint8Array(), mime: 'image/png' }),
    ).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    await expect(vision.convertImage({ bytes: png, mime: 'image/svg+xml' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
  });

  it('posts a transcription-style chat request for audio', async () => {
    let calls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      expect(String(input)).toBe('https://api.example.com/v1/chat/completions');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        messages: Array<{
          role: string;
          content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
        }>;
      };
      expect(body.model).toBe('vision-x');
      expect(String(body.messages[0]?.content).toLowerCase()).toContain('transcribe');
      const parts = body.messages[1]?.content as Array<{
        type: string;
        text?: string;
        image_url?: { url: string };
      }>;
      expect(parts[0]?.text?.toLowerCase()).toContain('transcribe');
      expect(parts[1]?.image_url?.url.startsWith('data:audio/mpeg;base64,')).toBe(true);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Hello there' } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const helper = ai({
      baseURL: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'vision-x',
    });
    await expect(
      helper.convertAudio({ bytes: new Uint8Array([1, 2, 3]), mime: 'audio/mpeg' }),
    ).resolves.toBe('Hello there\n');
    expect(calls).toBe(1);
  });
});
