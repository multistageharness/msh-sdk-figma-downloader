"""errors.py — typed error taxonomy for Figma REST failures (TR-16).

Twin of ts/src/errors.mjs. Each HTTP failure class has its own
type so `figma_get` can decide what is retryable and the CLI can map each to a
distinct exit code.

Retryable: 429 (rate limit), 5xx (server), network/timeout.
Non-retryable (fail fast): 401/403 (auth), 404 (not found).
"""

from __future__ import annotations


class FigmaError(Exception):
    """Base class for every typed Figma error. Carries an `exit_code`."""

    def __init__(self, message: str, status: int | None = None, exit_code: int = 1, retryable: bool = False):
        super().__init__(message)
        self.message = message
        self.status = status
        self.exit_code = exit_code
        self.retryable = retryable


class FigmaAuthError(FigmaError):
    """401 / 403 — bad or missing token, or no access. Fail fast."""

    def __init__(self, message: str, status: int = 401):
        super().__init__(message, status=status, exit_code=3, retryable=False)


class FigmaNotFoundError(FigmaError):
    """404 — the file key does not exist. Fail fast."""

    def __init__(self, message: str, status: int = 404):
        super().__init__(message, status=status, exit_code=4, retryable=False)


class FigmaRateLimitError(FigmaError):
    """429 — rate limited. Retryable (honours Retry-After); exit 5 if persists."""

    def __init__(self, message: str, status: int = 429):
        super().__init__(message, status=status, exit_code=5, retryable=True)


class FigmaServerError(FigmaError):
    """5xx — server error. Retryable; exit 6 if persists."""

    def __init__(self, message: str, status: int = 500):
        super().__init__(message, status=status, exit_code=6, retryable=True)


class FigmaNetworkError(FigmaError):
    """Network blip — retryable; exit 6 if persists."""

    def __init__(self, message: str):
        super().__init__(message, status=None, exit_code=6, retryable=True)


class FigmaTimeoutError(FigmaError):
    """Per-request abort timeout — retryable; exit 7 if persists."""

    def __init__(self, message: str):
        super().__init__(message, status=None, exit_code=7, retryable=True)


def error_for_status(status: int, path_and_query: str, body: str = "") -> FigmaError:
    """Build the right typed error for a non-2xx HTTP status."""
    tail = f": {str(body)[:200]}" if body else ""
    msg = f"Figma API {status} for {path_and_query}{tail}"
    if status in (401, 403):
        return FigmaAuthError(msg, status)
    if status == 404:
        return FigmaNotFoundError(msg, status)
    if status == 429:
        return FigmaRateLimitError(msg, status)
    if status >= 500:
        return FigmaServerError(msg, status)
    return FigmaError(msg, status=status, exit_code=1, retryable=False)


def exit_code_for(err: BaseException) -> int:
    """The exit code for any raised value (typed errors carry their own)."""
    if isinstance(err, FigmaError):
        return err.exit_code
    return 1
