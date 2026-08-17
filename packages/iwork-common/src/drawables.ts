import type { Block } from '@mdgate/document';
import type { IWorkArchive } from './archive.js';
import { deref, derefAll, getObject } from './archive.js';
import {
  decodeMessage,
  fieldBytes,
  fieldVarint,
  type ProtoField,
  readReference,
  readReferences,
} from './protobuf.js';
import { shapeStorageBlocks, storageToBlocks } from './storage.js';
import { drawableAsTable } from './table.js';
import { TYPE } from './types.js';

/** Walk a drawable reference tree collecting text and tables. */
export function collectDrawableBlocks(archive: IWorkArchive, objId: number | undefined): Block[] {
  const obj = getObject(archive, objId);
  if (obj === undefined) return [];
  return collectDrawableObject(archive, obj);
}

export function collectDrawableObject(
  archive: IWorkArchive,
  obj: { id: number; type: number; fields: ProtoField[] },
): Block[] {
  const asTable = drawableAsTable(archive, obj);
  if (asTable.length > 0) return asTable;

  const asShape = shapeStorageBlocks(archive, obj);
  if (asShape.length > 0) return asShape;

  if (obj.type === TYPE.TSD_GROUP) {
    const blocks: Block[] = [];
    for (const child of derefAll(archive, obj.fields, 2)) {
      blocks.push(...collectDrawableObject(archive, child));
    }
    return blocks;
  }

  if (obj.type === TYPE.TSWP_DRAWABLE_ATTACHMENT) {
    const drawableId = readReference(fieldBytes(obj.fields, 1));
    return collectDrawableBlocks(archive, drawableId);
  }

  return [];
}

export function findDocumentObject(
  archive: IWorkArchive,
  type: number,
): { id: number; type: number; fields: ProtoField[] } | undefined {
  const preferred = archive.objects.get(1);
  if (preferred !== undefined && preferred.type === type) return preferred;
  for (const obj of archive.objects.values()) {
    if (obj.type === type) return obj;
  }
  return undefined;
}

export function bodyStorageFromPages(archive: IWorkArchive): ProtoField[] | undefined {
  const doc = findDocumentObject(archive, TYPE.TP_DOCUMENT);
  if (doc === undefined) return undefined;
  const storage = deref(archive, doc.fields, 4);
  return storage?.fields;
}

export function numbersSheets(archive: IWorkArchive): { name: string; drawables: number[] }[] {
  const doc =
    findDocumentObject(archive, TYPE.TN_DOCUMENT) ??
    [...archive.objects.values()].find(
      (o) => o.type === 1 && readReferences(o.fields, 1).length > 0,
    );
  if (doc === undefined) return [];
  const sheets: { name: string; drawables: number[] }[] = [];
  for (const sheet of derefAll(archive, doc.fields, 1)) {
    const nameBytes = fieldBytes(sheet.fields, 1);
    const name = nameBytes !== undefined ? new TextDecoder().decode(nameBytes) : 'Sheet';
    sheets.push({
      name,
      drawables: readReferences(sheet.fields, 2),
    });
  }
  return sheets;
}

export function keynoteSlides(archive: IWorkArchive): number[] {
  const doc =
    findDocumentObject(archive, TYPE.KN_DOCUMENT) ??
    [...archive.objects.values()].find((o) => {
      if (o.type !== 1) return false;
      return readReference(fieldBytes(o.fields, 2)) !== undefined;
    });
  if (doc === undefined) return [];
  const show = deref(archive, doc.fields, 2);
  if (show === undefined) return [];

  // ShowArchive.slideTree (field 3) is either an embedded SlideTreeArchive or a Reference.
  const treeField = fieldBytes(show.fields, 3);
  let rootId: number | undefined;
  if (treeField !== undefined) {
    const asRef = readReference(treeField);
    if (asRef !== undefined && getObject(archive, asRef)?.type === TYPE.KN_SLIDE_NODE) {
      rootId = asRef;
    } else {
      // Embedded SlideTreeArchive { rootSlideNode = 1 }
      rootId = readReference(fieldBytes(decodeMessage(treeField), 1)) ?? asRef;
    }
  }

  const slideIds: number[] = [];
  walkSlideNode(archive, rootId, slideIds);
  return slideIds;
}

function walkSlideNode(archive: IWorkArchive, nodeId: number | undefined, out: number[]): void {
  const node = getObject(archive, nodeId);
  if (node === undefined) return;
  const slideId = readReference(fieldBytes(node.fields, 2));
  if (slideId !== undefined) {
    const slide = getObject(archive, slideId);
    if (slide !== undefined) {
      const inDoc = fieldVarint(slide.fields, 19);
      if (inDoc === undefined || inDoc !== 0) out.push(slideId);
    }
  }
  for (const childId of readReferences(node.fields, 1)) {
    walkSlideNode(archive, childId, out);
  }
}

/** Collect text blocks from a Keynote slide archive. */
export function slideToBlocks(archive: IWorkArchive, slideId: number): Block[] {
  const slide = getObject(archive, slideId);
  if (slide === undefined) return [];
  const blocks: Block[] = [];

  const pushRef = (field: number): void => {
    blocks.push(...collectDrawableBlocks(archive, readReference(fieldBytes(slide.fields, field))));
  };

  pushRef(5);
  pushRef(6);
  pushRef(30);
  for (const id of readReferences(slide.fields, 7)) {
    blocks.push(...collectDrawableBlocks(archive, id));
  }

  const note = deref(archive, slide.fields, 27);
  if (note !== undefined) {
    const noteBlocks = shapeStorageBlocks(archive, note);
    if (noteBlocks.length > 0) {
      blocks.push({ type: 'blockQuote', blocks: noteBlocks });
    } else {
      const storageBlocks = storageToBlocks(archive, note.fields);
      if (storageBlocks.length > 0) blocks.push({ type: 'blockQuote', blocks: storageBlocks });
    }
  }

  return blocks;
}
