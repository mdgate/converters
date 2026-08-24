import { describe, expect, it } from 'vitest';
import { aes128CbcDecrypt, md5 } from '../src/crypto.js';
import { openEncrypt } from '../src/encrypt.js';

function hex(s: string): Uint8Array {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

describe('pdf crypto', () => {
  it('matches the MD5 of hello', () => {
    expect(Buffer.from(md5(new TextEncoder().encode('hello'))).toString('hex')).toBe(
      '5d41402abc4b2a76b9719d911017c592',
    );
  });

  it('decrypts a NIST AES-128-CBC block', () => {
    const pt = aes128CbcDecrypt(
      hex('2b7e151628aed2a6abf7158809cf4f3c'),
      hex('000102030405060708090a0b0c0d0e0f'),
      hex('7649abac8119b246cee98e9b12e9197d5086cb9b507219ee95db113a917678b2'),
    );
    expect(Buffer.from(pt.subarray(0, 16)).toString('hex')).toBe(
      '6bc1bee22e409f96e93d7e117393172a',
    );
  });

  it('accepts the empty user password on a Unicode-chart Standard/AESV2 header', () => {
    const crypt = openEncrypt({
      v: 4,
      r: 4,
      keyLength: 128,
      o: hex('FD2C3D3CE19144D01850580C7870BD45FBA3474163AAC53F0647AD421D4D7030'),
      u: hex('7C6F11F882BE8C4EAF199AEAAB445E7F28BF4E5E4E758A4164004E56FFFA0108'),
      p: -3372,
      id: hex('0131839804E2A7492054D48F26E5B050'),
      stmF: '/StdCF',
      strF: '/StdCF',
      cfm: '/AESV2',
      encryptMetadata: true,
    });
    expect(crypt?.stm).toBe('aesv2');
    expect(crypt?.key.length).toBe(16);
  });

  it('does not treat Identity StmF/StrF as a locked document', () => {
    const crypt = openEncrypt({
      v: 5,
      r: 6,
      keyLength: 256,
      o: new Uint8Array(32),
      u: new Uint8Array(32),
      p: -4,
      id: new Uint8Array(16),
      stmF: '/Identity',
      strF: '/Identity',
      cfm: '/AESV3',
      encryptMetadata: true,
    });
    expect(crypt).toEqual({ key: new Uint8Array(), stm: 'none', str: 'none' });
  });
});
