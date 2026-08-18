export type ConvertHint = {
  /** Sniff hint only. Never read from disk. Needed for signature-less formats such as CSV. */
  path?: string;
  /** 1-based page. Honored by `image()` and PDF. Other converters ignore it. */
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
