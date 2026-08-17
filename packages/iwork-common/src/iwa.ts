import { ConvertError } from '@mdgate/core';
import { decodeMessage, fieldMessages, fieldVarint, type ProtoField } from './protobuf.js';
import { readVarint, snappyDecode, snappyEncodeLiterals, writeVarint } from './snappy.js';

export interface IwaObject {
  id: number;
  type: number;
  payload: Uint8Array;
  fields: ProtoField[];
}

/**
 * Parse one `.iwa` component into archived objects.
 * Layout: repeated { chunkType=0, u24le length, snappy block }. Decompressed
 * chunks form one stream of { varint ArchiveInfoLen, ArchiveInfo, payloads… };
 * ArchiveInfo records routinely span the 64 KiB snappy block boundary.
 */
export function parseIwa(bytes: Uint8Array): IwaObject[] {
  const objects: IwaObject[] = [];
  const plains: Uint8Array[] = [];
  let total = 0;
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const chunkType = bytes[offset]!;
    const chunkLen = bytes[offset + 1]! | (bytes[offset + 2]! << 8) | (bytes[offset + 3]! << 16);
    offset += 4;
    if (chunkLen === 0) continue;
    if (offset + chunkLen > bytes.length) {
      throw ConvertError.malformed('truncated IWA snappy chunk');
    }
    const chunk = bytes.subarray(offset, offset + chunkLen);
    offset += chunkLen;
    if (chunkType !== 0) continue;
    const plain = snappyDecode(chunk);
    total += plain.length;
    if (total > MAX_IWA_PLAIN) {
      throw ConvertError.resourceLimit(
        'max_entry_bytes',
        `IWA stream exceeds ${MAX_IWA_PLAIN} decompressed bytes`,
      );
    }
    plains.push(plain);
  }
  if (plains.length === 0) return objects;
  if (plains.length === 1) {
    parseIwaPlain(plains[0]!, objects);
    return objects;
  }
  const joined = new Uint8Array(total);
  let o = 0;
  for (const part of plains) {
    joined.set(part, o);
    o += part.length;
  }
  parseIwaPlain(joined, objects);
  return objects;
}

const MAX_IWA_PLAIN = 64 * 1024 * 1024;

function parseIwaPlain(plain: Uint8Array, objects: IwaObject[]): void {
  let i = 0;
  while (i < plain.length) {
    const [infoLen, afterLen] = readVarint(plain, i);
    if (infoLen === 0) break;
    if (afterLen + infoLen > plain.length) {
      throw ConvertError.malformed('truncated ArchiveInfo');
    }
    const infoBytes = plain.subarray(afterLen, afterLen + infoLen);
    i = afterLen + infoLen;
    const infoFields = decodeMessage(infoBytes);
    const identifier = fieldVarint(infoFields, 1) ?? 0;
    const messageInfos = fieldMessages(infoFields, 2);
    for (const mi of messageInfos) {
      const type = fieldVarint(mi, 1) ?? 0;
      const length = fieldVarint(mi, 3) ?? 0;
      if (i + length > plain.length) {
        throw ConvertError.malformed('truncated IWA payload');
      }
      const payload = plain.subarray(i, i + length);
      i += length;
      objects.push({
        id: identifier,
        type,
        payload,
        fields: decodeMessage(payload),
      });
    }
  }
}

/** Wrap ArchiveInfo+payloads in a single snappy IWA chunk (fixtures / tests). */
export function buildIwa(objects: { id: number; type: number; payload: Uint8Array }[]): Uint8Array {
  const plain: number[] = [];
  for (const obj of objects) {
    const messageInfo = [...encodeVarint(1, obj.type), ...encodeVarint(3, obj.payload.length)];
    const archiveInfo = [
      ...encodeVarint(1, obj.id),
      ...encodeBytes(2, Uint8Array.from(messageInfo)),
    ];
    writeVarint(plain, archiveInfo.length);
    for (const b of archiveInfo) plain.push(b);
    for (let i = 0; i < obj.payload.length; i += 1) plain.push(obj.payload[i]!);
  }
  const compressed = snappyEncodeLiterals(Uint8Array.from(plain));
  const out = new Uint8Array(4 + compressed.length);
  out[0] = 0;
  out[1] = compressed.length & 0xff;
  out[2] = (compressed.length >> 8) & 0xff;
  out[3] = (compressed.length >> 16) & 0xff;
  out.set(compressed, 4);
  return out;
}

function encodeVarint(field: number, value: number): number[] {
  const out: number[] = [];
  writeV(out, (field << 3) | 0);
  writeV(out, value);
  return out;
}

function encodeBytes(field: number, value: Uint8Array): number[] {
  const out: number[] = [];
  writeV(out, (field << 3) | 2);
  writeV(out, value.length);
  for (let i = 0; i < value.length; i += 1) out.push(value[i]!);
  return out;
}

function writeV(out: number[], value: number): void {
  let v = value >>> 0;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
}
