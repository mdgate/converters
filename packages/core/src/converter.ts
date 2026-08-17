export type ConvertHint = {
  /** Filename or extension used only for sniffing, never read from disk. */
  path?: string;
};

/** Per-conversion input. `create` merges capability plugins by `kind`. */
export type ConvertOptions = ConvertHint & {
  [key: string]: unknown;
};

export type ConvertResult = {
  markdown: string;
};

/**
 * A format family that can sniff bytes and emit markdown.
 * One converter may accept several extensions (e.g. office).
 */
export interface Converter {
  readonly id: string;
  sniff(bytes: Uint8Array, hint?: ConvertHint): number;
  convert(bytes: Uint8Array, options?: ConvertOptions): ConvertResult | Promise<ConvertResult>;
}
