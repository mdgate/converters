import { ConvertError } from '@mdgate/core';
import { type Document, emptyDocument } from '@mdgate/document';
import { bodyStorageFromPages, openIWork, storageToBlocks } from '@mdgate/iwork-common';

export function parse(bytes: Uint8Array): Document {
  const archive = openIWork(bytes, 'pages');
  const storage = bodyStorageFromPages(archive);
  if (storage === undefined) {
    throw ConvertError.malformed('pages document has no body storage');
  }
  const doc = emptyDocument();
  doc.blocks.push(...storageToBlocks(archive, storage));
  return doc;
}
