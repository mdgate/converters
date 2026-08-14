/** Input format. Selects the parser. Not part of the public package API. */
export type Format =
  | 'doc'
  | 'docx'
  | 'odt'
  | 'ppt'
  | 'pptx'
  | 'rtf'
  | 'epub'
  | 'excel'
  | 'ods'
  | 'odp'
  | 'csv';

export {
  formatFromBytes,
  formatFromExtension,
  formatFromPath,
} from './detect.js';
