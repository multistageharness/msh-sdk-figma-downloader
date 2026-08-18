// errors.mjs — a typed error taxonomy for Figma REST failures (TR-16).
//
// The four demos collapsed every failure into a bare `Error` (or swallowed it to
// null), so callers could not distinguish "your token is wrong" (give up) from
// "rate limited" (back off and retry) from "transient 5xx" (retry). This module
// gives each HTTP failure class its own type so `figmaGet` can decide what is
// retryable and the CLI can map each to a distinct exit code.
//
// Retryable: 429 (rate limit), 5xx (server), network/timeout.
// Non-retryable (fail fast): 401/403 (auth), 404 (not found).

/** Base class for every typed Figma error. Carries an `exitCode`. */
export class FigmaError extends Error {
  /** @param {string} message @param {{ status?: number, exitCode?: number, retryable?: boolean }} [meta] */
  constructor(message, { status, exitCode = 1, retryable = false } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.exitCode = exitCode;
    this.retryable = retryable;
  }
}

/** 401 / 403 — bad or missing token, or no access to the file. Fail fast. */
export class FigmaAuthError extends FigmaError {
  constructor(message, status = 401) {
    super(message, { status, exitCode: 3, retryable: false });
  }
}

/** 404 — the file key does not exist. Fail fast. */
export class FigmaNotFoundError extends FigmaError {
  constructor(message, status = 404) {
    super(message, { status, exitCode: 4, retryable: false });
  }
}

/** 429 — rate limited. Retryable (honours Retry-After); exit 5 if it persists. */
export class FigmaRateLimitError extends FigmaError {
  constructor(message, status = 429) {
    super(message, { status, exitCode: 5, retryable: true });
  }
}

/** 5xx — server error. Retryable; exit 6 if it persists. */
export class FigmaServerError extends FigmaError {
  constructor(message, status = 500) {
    super(message, { status, exitCode: 6, retryable: true });
  }
}

/** Network blip (ECONNRESET / socket) — retryable; exit 6 if it persists. */
export class FigmaNetworkError extends FigmaError {
  constructor(message) {
    super(message, { status: undefined, exitCode: 6, retryable: true });
  }
}

/** Per-request abort timeout — retryable; exit 7 if it persists. */
export class FigmaTimeoutError extends FigmaError {
  constructor(message) {
    super(message, { status: undefined, exitCode: 7, retryable: true });
  }
}

/**
 * Build the right typed error for a non-2xx HTTP status.
 * @param {number} status
 * @param {string} pathAndQuery
 * @param {string} body  truncated response body for context
 */
export function errorForStatus(status, pathAndQuery, body = '') {
  const tail = body ? `: ${String(body).slice(0, 200)}` : '';
  const msg = `Figma API ${status} for ${pathAndQuery}${tail}`;
  if (status === 401 || status === 403) return new FigmaAuthError(msg, status);
  if (status === 404) return new FigmaNotFoundError(msg, status);
  if (status === 429) return new FigmaRateLimitError(msg, status);
  if (status >= 500) return new FigmaServerError(msg, status);
  return new FigmaError(msg, { status, exitCode: 1, retryable: false });
}

/** The exit code for any thrown value (typed errors carry their own). */
export function exitCodeFor(err) {
  if (err instanceof FigmaError) return err.exitCode;
  return 1;
}
