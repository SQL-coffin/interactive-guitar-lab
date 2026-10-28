import type { ApiErrorCode } from "./contract";

/** The single error type the UI handles; adapters convert transport and engine errors into it. */
export class ServiceError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number | undefined;

  constructor(code: ApiErrorCode, message: string, status?: number) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.status = status;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function toServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof TypeError || error instanceof RangeError) {
    return new ServiceError("invalid_request", error.message);
  }
  const message = error instanceof Error ? error.message : "Unexpected error.";
  return new ServiceError("internal_error", message);
}
