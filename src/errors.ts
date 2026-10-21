export type TefasErrorCode =
  | "INVALID_ARGUMENT"
  | "ACCESS_DENIED"
  | "HTTP_ERROR"
  | "SOURCE_ERROR"
  | "INVALID_RESPONSE"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "ABORTED";

export interface TefasErrorOptions extends ErrorOptions {
  readonly status?: number;
  readonly sourceCode?: string | number;
}

export class TefasError extends Error {
  readonly code: TefasErrorCode;
  readonly status: number | undefined;
  readonly sourceCode: string | number | undefined;

  constructor(
    code: TefasErrorCode,
    message: string,
    options: TefasErrorOptions = {},
  ) {
    super(message, options);

    this.name = "TefasError";
    this.code = code;
    this.status = options.status;
    this.sourceCode = options.sourceCode;
  }
}
