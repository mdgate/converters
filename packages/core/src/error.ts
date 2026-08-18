/** Machine-readable conversion failure kind, published as `error.code`. */
export type ConvertErrorCode =
  | 'unsupported'
  | 'malformed'
  | 'encrypted'
  | 'resourceLimit'
  | 'missingPart'
  | 'io';

/** Why a conversion could not produce a useful result. */
export class ConvertError extends Error {
  readonly code: ConvertErrorCode;
  readonly part: string | undefined;
  readonly detail: string | undefined;
  readonly limit: string | undefined;

  private constructor(
    code: ConvertErrorCode,
    message: string,
    extra: { part?: string; detail?: string; limit?: string } = {},
  ) {
    super(message);
    this.name = 'ConvertError';
    this.code = code;
    this.part = extra.part;
    this.detail = extra.detail;
    this.limit = extra.limit;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static unsupported(what: string): ConvertError {
    return new ConvertError('unsupported', `unsupported input: ${what}`);
  }

  static malformed(detail: string): ConvertError {
    return new ConvertError('malformed', `malformed document: ${detail}`, { detail });
  }

  static malformedPart(part: string, detail: string): ConvertError {
    return new ConvertError('malformed', `malformed document (${part}): ${detail}`, {
      part,
      detail,
    });
  }

  static encrypted(): ConvertError {
    return new ConvertError('encrypted', 'document is encrypted');
  }

  static resourceLimit(limit: string, detail: string): ConvertError {
    return new ConvertError('resourceLimit', `resource limit exceeded (${limit}): ${detail}`, {
      limit,
      detail,
    });
  }

  static missingPart(part: string): ConvertError {
    return new ConvertError('missingPart', `missing required part: ${part}`, { part });
  }

  static io(err: unknown): ConvertError {
    const msg = err instanceof Error ? err.message : String(err);
    return new ConvertError('io', `io error: ${msg}`);
  }

  /** True for errors that must abort even when a part is optional. */
  isFatal(): boolean {
    return this.code === 'resourceLimit';
  }
}
