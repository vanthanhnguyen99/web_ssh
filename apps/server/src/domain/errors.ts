import type { ApiError, ErrorCode } from "@workspace/shared";
export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status = 400,
    public readonly details?: Record<string, string>,
  ) {
    super(message);
  }
  toJSON(): ApiError {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}
export function publicError(error: unknown): ApiError {
  return error instanceof DomainError
    ? error.toJSON()
    : { code: "INTERNAL_ERROR", message: "An internal error occurred" };
}
