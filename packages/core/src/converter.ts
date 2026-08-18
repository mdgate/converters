export type ConvertHint = {
  path?: string;
  page?: number;
};

export type Convert = (bytes: Uint8Array, hint?: ConvertHint) => Promise<string>;

export type ConvertOptions = ConvertHint & {
  convert?: Convert;
};

export type ConvertResult = {
  markdown: string;
};

export interface Converter {
  readonly id: string;
  sniff(bytes: Uint8Array, hint?: ConvertHint): number;
  convert(bytes: Uint8Array, options?: ConvertOptions): ConvertResult | Promise<ConvertResult>;
}
