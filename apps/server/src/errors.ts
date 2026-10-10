export type ErrorCode =
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "otp_invalid"
  | "otp_expired"
  | "otp_locked"
  | "consent_required"
  | "no_coverage"
  | "payload_too_large"
  | "unsupported_media_type"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  otp_invalid: 400,
  otp_expired: 400,
  otp_locked: 400,
  consent_required: 403,
  no_coverage: 422,
  payload_too_large: 413,
  unsupported_media_type: 415,
  internal: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const notFound = (what = "המשאב") => new AppError("not_found", `${what} לא נמצא`);
