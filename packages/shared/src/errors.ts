export const ErrorCodes = {
  INVALID_REQUEST: "invalid_request",
  INVALID_SIGNATURE: "invalid_signature",
  UNSUPPORTED_PROTOCOL_VERSION: "unsupported_protocol_version",
  TIMESTAMP_OUT_OF_RANGE: "timestamp_out_of_range",
  DUPLICATE_NONCE: "duplicate_nonce",
  UNAUTHORIZED: "unauthorized",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  RATE_LIMITED: "rate_limited",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class ChatError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ChatError";
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details && { details: this.details }),
      },
    };
  }
}
