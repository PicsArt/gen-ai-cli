import { CliError, ExitCode } from './base.ts';

export class NetworkError extends CliError {
  readonly exitCode = ExitCode.NETWORK_ERROR;
  hint = 'Check your internet connection. If behind a proxy, set HTTPS_PROXY.';

  get friendlyMessage(): string {
    return `Could not reach the server: ${this.message}`;
  }
}

/**
 * libuv / undici error codes that mean "the request never reached the server"
 * (DNS, TCP, TLS, socket-level). Anything here is a transport failure, never an
 * application-level rejection.
 */
const NETWORK_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'EPROTO',
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** Message fragments `fetch` surfaces for transport failures with no `code`. */
const NETWORK_MESSAGE_PATTERN =
  /fetch failed|failed to fetch|socket hang up|network (?:error|is unreachable|request failed)|other side closed|premature close|operation was aborted|request timed out|getaddrinfo|tunneling socket/i;

/**
 * True when `err` is a transport-level failure — the request never got an HTTP
 * response back (DNS failure, refused/reset connection, TLS problem, abort or
 * timeout). Used to tell "no network" apart from "the server said no", so a
 * sandboxed or offline shell reports `NetworkError` (exit 4) instead of being
 * remapped to a misleading `AuthError` (exit 3).
 *
 * `fetch` reports transport failures as a bare `TypeError: fetch failed` and
 * hides the real code on `.cause`, so the whole cause chain is inspected.
 */
export function isNetworkError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; current !== null && current !== undefined && depth < 8; depth++) {
    if (typeof current !== 'object') return false;
    const e = current as { name?: unknown; message?: unknown; code?: unknown; errors?: unknown; cause?: unknown };

    if (typeof e.code === 'string' && NETWORK_ERROR_CODES.has(e.code)) return true;
    // AbortSignal.timeout() rejects with TimeoutError; an explicit abort with AbortError.
    if (e.name === 'AbortError' || e.name === 'TimeoutError') return true;
    if (typeof e.message === 'string' && NETWORK_MESSAGE_PATTERN.test(e.message)) return true;
    // AggregateError from happy-eyeballs: every attempt failed, each with its own code.
    if (Array.isArray(e.errors) && e.errors.some((inner) => isNetworkError(inner))) return true;

    current = e.cause;
  }
  return false;
}
