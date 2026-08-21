import { ConvertError } from '@mdgate/core';
import { type Document, emptyDocument } from '@mdgate/document';
import {
  bodyStorageFromPages,
  type IWorkArchive,
  openIWork,
  parsePreIwa,
  storageToBlocks,
} from '@mdgate/iwork-common';

export function parse(bytes: Uint8Array): Document {
  let archive: IWorkArchive;
  try {
    archive = openIWork(bytes, 'pages');
  } catch (e) {
    if (e instanceof ConvertError && e.code === 'encrypted') throw e;
    return parsePreIwa(bytes, 'pages');
  }
  const storage = bodyStorageFromPages(archive);
  if (storage === undefined) {
    throw ConvertError.malformed('pages document has no body storage');
  }
  const doc = emptyDocument();
  doc.blocks.push(...storageToBlocks(archive, storage));
  return doc;
}
