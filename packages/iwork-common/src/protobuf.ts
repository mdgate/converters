import { ConvertError } from '@mdgate/core';
import { readVarint } from './snappy.js';

/** One decoded protobuf field. Length-delimited values stay as bytes. */
export type ProtoValue =
  | { kind: 'varint'; value: number }
  | { kind: 'fixed64'; value: bigint }
  | { kind: 'fixed32'; value: number }
  | { kind: 'bytes'; value: Uint8Array };

export interface ProtoField {
  field: number;
  value: ProtoValue;
}

/** Decode all top-level fields of a protobuf message (proto2/3 wire). */
export function decodeMessage(bytes: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let i = 0;
  while (i < bytes.length) {
    const [tag, afterTag] = readVarint(bytes, i);
    i = afterTag;
    const field = tag >>> 3;
    const wire = tag & 7;
    if (field === 0) break;
    if (wire === 0) {
      const [value, next] = readVarint(bytes, i);
      i = next;
      fields.push({ field, value: { kind: 'varint', value } });
    } else if (wire === 1) {
      if (i + 8 > bytes.length) throw ConvertError.malformed('truncated fixed64');
      const view = new DataView(bytes.buffer, bytes.byteOffset + i, 8);
      fields.push({ field, value: { kind: 'fixed64', value: view.getBigUint64(0, true) } });
      i += 8;
    } else if (wire === 5) {
      if (i + 4 > bytes.length) throw ConvertError.malformed('truncated fixed32');
      const view = new DataView(bytes.buffer, bytes.byteOffset + i, 4);
      fields.push({ field, value: { kind: 'fixed32', value: view.getUint32(0, true) } });
      i += 4;
    } else if (wire === 2) {
      const [len, afterLen] = readVarint(bytes, i);
      i = afterLen;
      if (i + len > bytes.length) throw ConvertError.malformed('truncated length-delimited');
      fields.push({ field, value: { kind: 'bytes', value: bytes.subarray(i, i + len) } });
      i += len;
    } else {
      throw ConvertError.malformed(`unsupported protobuf wire type ${wire}`);
    }
  }
  return fields;
}

export function fieldBytes(fields: readonly ProtoField[], field: number): Uint8Array | undefined {
  for (const f of fields) {
    if (f.field === field && f.value.kind === 'bytes') return f.value.value;
  }
  return undefined;
}

export function fieldVarint(fields: readonly ProtoField[], field: number): number | undefined {
  for (const f of fields) {
    if (f.field === field && f.value.kind === 'varint') return f.value.value;
  }
  return undefined;
}

export function fieldString(fields: readonly ProtoField[], field: number): string | undefined {
  const bytes = fieldBytes(fields, field);
  if (bytes === undefined) return undefined;
  return new TextDecoder('utf-8').decode(bytes);
}

export function fieldMessages(fields: readonly ProtoField[], field: number): ProtoField[][] {
  const out: ProtoField[][] = [];
  for (const f of fields) {
    if (f.field === field && f.value.kind === 'bytes') out.push(decodeMessage(f.value.value));
  }
  return out;
}

export function fieldAllBytes(fields: readonly ProtoField[], field: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const f of fields) {
    if (f.field === field && f.value.kind === 'bytes') out.push(f.value.value);
  }
  return out;
}

export function fieldAllVarints(fields: readonly ProtoField[], field: number): number[] {
  const out: number[] = [];
  for (const f of fields) {
    if (f.field === field && f.value.kind === 'varint') out.push(f.value.value);
  }
  return out;
}

/** TSP.Reference — identifier at field 1. */
export function readReference(bytes: Uint8Array | undefined): number | undefined {
  if (bytes === undefined) return undefined;
  return fieldVarint(decodeMessage(bytes), 1);
}

export function readReferences(fields: readonly ProtoField[], field: number): number[] {
  const out: number[] = [];
  for (const msg of fieldMessages(fields, field)) {
    const id = fieldVarint(msg, 1);
    if (id !== undefined) out.push(id);
  }
  return out;
}

export function encodeVarintField(field: number, value: number): number[] {
  const out: number[] = [];
  writeTag(out, field, 0);
  writeVarintNums(out, value);
  return out;
}

export function encodeBytesField(field: number, value: Uint8Array): number[] {
  const out: number[] = [];
  writeTag(out, field, 2);
  writeVarintNums(out, value.length);
  for (let i = 0; i < value.length; i += 1) out.push(value[i]!);
  return out;
}

export function encodeStringField(field: number, value: string): number[] {
  return encodeBytesField(field, new TextEncoder().encode(value));
}

export function encodeMessageField(field: number, message: number[]): number[] {
  return encodeBytesField(field, Uint8Array.from(message));
}

function writeTag(out: number[], field: number, wire: number): void {
  writeVarintNums(out, (field << 3) | wire);
}

function writeVarintNums(out: number[], value: number): void {
  let v = value >>> 0;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
}

/** IEEE754 little-endian float64 bits as protobuf fixed64 payload bytes. */
export function float64Bytes(value: number): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value, true);
  return new Uint8Array(buf);
}
