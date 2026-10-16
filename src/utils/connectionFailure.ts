/**
 * Transport codes that mean the connection failed before any answer.
 * The unreachable-network pair (`ENETUNREACH`, `EHOSTUNREACH`) is as transient
 * as a dropped DNS answer. Timeout codes (`ECONNABORTED`, `ETIMEDOUT`,
 * `ERR_CANCELED`) are deliberately absent: each caller maps timeouts
 * separately and first. Whether to retry is the caller's decision, not this
 * module's.
 */
export const CONNECTION_FAILURE_CODES: ReadonlySet<string> = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'EPIPE',
  'ENETUNREACH',
  'EHOSTUNREACH'
]);

export function isConnectionFailureCode(code: string | undefined): boolean {
  return code !== undefined && CONNECTION_FAILURE_CODES.has(code);
}
