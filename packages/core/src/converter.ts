export type ConvertHint = {
  /** Filename or extension used only for sniffing, never read from disk. */
  path?: string;
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
  convert(bytes: Uint8Array, hint?: ConvertHint): ConvertResult | Promise<ConvertResult>;
}
