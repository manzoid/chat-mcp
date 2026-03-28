export const PROTOCOL_VERSION = 1;
export const MIN_PROTOCOL_VERSION = 1;

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
export const SESSION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export const SSE_HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 seconds
export const NONCE_GC_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export const MAX_ATTACHMENT_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
export const DEFAULT_ATTACHMENT_RETENTION_DAYS = 90;

export const PROTOCOL_VERSION_HEADER = "x-chat-protocol-version";
export const MIN_PROTOCOL_VERSION_HEADER = "x-chat-protocol-min-version";
export const RATE_LIMIT_HEADER = "x-ratelimit-limit";
export const RATE_LIMIT_REMAINING_HEADER = "x-ratelimit-remaining";
export const RATE_LIMIT_RESET_HEADER = "x-ratelimit-reset";
