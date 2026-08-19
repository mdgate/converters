import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConvertError } from '@mdgate/core';
import { describe, expect, it } from 'vitest';
import { email, toMarkdown } from '../src/index.js';

const enc = new TextEncoder();
const here = dirname(fileURLToPath(import.meta.url));
const docPath = join(here, '../../../test/fixtures/doc/text.doc');

const EML = enc.encode(
  [
    'From: Alice <alice@example.com>',
    'To: Bob <bob@example.com>',
    'Cc: Carol <carol@example.com>',
    'Subject: Hello from mail',
    'Date: Mon, 01 Jan 2000 00:00:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Hello, this is the body.',
    '',
  ].join('\r\n'),
);

describe('email', () => {
  it('sniffs content, extension, and unrelated bytes', () => {
    const converter = email();
    expect(converter.id).toBe('email');
    expect(converter.sniff(EML)).toBe(3);
    expect(converter.sniff(enc.encode('MIME-Version: 1.0\r\n\r\nbody\n'))).toBe(3);
    expect(
      converter.sniff(enc.encode("---\n- name: x\n  from: '@perlpunk'\ntags: mapping\n"), {
        path: '26DV.yaml',
      }),
    ).toBe(0);
    expect(converter.sniff(new Uint8Array([1]), { path: 'note.eml' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'note.msg' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'inbox.mbox' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]), { path: 'msg.emlx' })).toBe(1);
    expect(converter.sniff(new Uint8Array([1]))).toBe(0);
    expect(converter.sniff(enc.encode('not email at all'))).toBe(0);
  });

  it('does not steal OLE WordDocument from @mdgate/doc', () => {
    const converter = email();
    const doc = readFileSync(docPath);
    expect(converter.sniff(doc)).toBe(0);
    expect(converter.sniff(doc, { path: 'letter.doc' })).toBe(0);
    expect(converter.sniff(doc, { path: 'letter.msg' })).toBe(1);
  });

  it('converts a synthetic RFC822 eml', async () => {
    const md = await toMarkdown(EML, { path: 'note.eml' });
    expect(md).toContain('# Hello from mail');
    expect(md).toContain('From');
    expect(md).toContain('alice@example.com');
    expect(md).toContain('bob@example.com');
    expect(md).toContain('carol@example.com');
    expect(md).toContain('Hello, this is the body.');
  });

  it('prefers html body and lists attachments', async () => {
    const bytes = enc.encode(
      [
        'From: a@b',
        'Subject: Html mail',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="mix"',
        '',
        '--mix',
        'Content-Type: multipart/alternative; boundary="alt"',
        '',
        '--alt',
        'Content-Type: text/plain',
        '',
        'plain body',
        '--alt',
        'Content-Type: text/html',
        '',
        '<p>html body</p>',
        '--alt--',
        '--mix',
        'Content-Type: application/pdf; name="note.pdf"',
        'Content-Disposition: attachment; filename="note.pdf"',
        'Content-Transfer-Encoding: base64',
        '',
        'JVBERg==',
        '--mix--',
        '',
      ].join('\r\n'),
    );
    const md = await toMarkdown(bytes);
    expect(md).toContain('html body');
    expect(md).not.toContain('plain body');
    expect(md).toContain('note.pdf');
  });

  it('splits mboxrd messages with a rule', async () => {
    const bytes = enc.encode(
      [
        'From a@b Mon Jan 01 00:00:00 2000',
        'From: a@b',
        'Subject: First',
        '',
        'one',
        'From c@d Mon Jan 01 00:00:01 2000',
        'From: c@d',
        'Subject: Second',
        '',
        'two',
        '',
      ].join('\r\n'),
    );
    expect(email().sniff(bytes)).toBe(3);
    const md = await toMarkdown(bytes, { path: 'inbox.mbox' });
    expect(md).toContain('# First');
    expect(md).toContain('# Second');
    expect(md).toContain('---');
  });

  it('refuses a PDF and an office file', async () => {
    await expect(toMarkdown(enc.encode('%PDF-1.7\n'), { path: 'x.eml' })).rejects.toMatchObject({
      name: 'ConvertError',
      code: 'unsupported',
    });
    expect(() => email().convert(enc.encode('%PDF-1.4\n'))).toThrow(ConvertError);
    const doc = readFileSync(docPath);
    expect(() => email().convert(doc)).toThrow(ConvertError);
    expect(() =>
      email().convert(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]), { path: 'x.eml' }),
    ).toThrow(ConvertError);
  });
});
