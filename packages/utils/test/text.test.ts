import { describe, expect, it } from 'vitest';
import { asciiStartsWith } from '../src/bytes.js';
import { fileExtension } from '../src/filename.js';
import { cleanText } from '../src/text.js';
import { isAbsoluteUri } from '../src/uri.js';

describe('text helpers', () => {
  it('cleans text like rust', () => {
    expect(cleanText('می\u{200c}خواهم')).toBe('می\u{200c}خواهم');
    expect(cleanText('a\u{ad}b\u{200b}c\u{feff}d\u{a0}e')).toBe('abcd e');
  });

  it('classifies uris', () => {
    expect(isAbsoluteUri('https://e.com')).toBe(true);
    expect(isAbsoluteUri('C:\\docs\\a.doc')).toBe(false);
  });

  it('extracts lowercased file extensions', () => {
    expect(fileExtension('a/b/Notes.DOCX')).toBe('docx');
    expect(fileExtension('C:\\docs\\sheet.XLSX')).toBe('xlsx');
    expect(fileExtension('noext')).toBeUndefined();
    expect(fileExtension('.hidden')).toBeUndefined();
    expect(fileExtension('trailing.')).toBeUndefined();
  });

  it('matches ascii byte prefixes', () => {
    expect(asciiStartsWith(Buffer.from('{\\rtf1 hi}'), '{\\rtf')).toBe(true);
    expect(asciiStartsWith(Buffer.from('{\\rt'), '{\\rtf')).toBe(false);
    expect(asciiStartsWith(Buffer.from('PK\u0003\u0004'), '{\\rtf')).toBe(false);
  });
});
