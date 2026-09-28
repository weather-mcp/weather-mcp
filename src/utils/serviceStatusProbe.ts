/**
 * What one check_service_status probe observed, and the answer → outcome mapping
 * both probes share: five outcomes — ok, rate_limited, http_error, empty_body and
 * no_response.
 *
 * Each probe accepts every HTTP status on its request (`validateStatus: () => true`)
 * and classifies the status itself. It cannot classify in a `catch`: the client's
 * response interceptor has already rewritten every axios error as an ApiError, which
 * carries no `.response` and no `.code`. Only a request that got no HTTP answer at
 * all still rejects, and that is the `no_response` outcome.
 *
 * Labels, actions and verdict copy live in src/handlers/statusHandler.ts.
 * tests/unit/service-status-probes.test.ts pins this module and both probes.
 */

// ok: 200 with a body · rate_limited: 429 · http_error: any other status ·
// empty_body: 200 with no body · no_response: rejected (no HTTP answer)
export type ProbeOutcome = 'ok' | 'rate_limited' | 'http_error' | 'empty_body' | 'no_response';

/**
 * `operational` is `outcome === 'ok'`; it exists for the handler's both-up test.
 * `httpStatus` is present for every outcome but `no_response`.
 * `empty_body` is a 200 with no body, so `httpStatus` is always 200 on it;
 * `operational` is `outcome === 'ok'` and is false for it.
 */
export interface ServiceProbeResult {
  operational: boolean;
  outcome: ProbeOutcome;
  httpStatus?: number;
  message: string;
  statusPage: string;
  timestamp: string;
}

export function classifyProbeStatus(status: number): Exclude<ProbeOutcome, 'no_response'> {
  if (status === 200) return 'ok';
  if (status === 429) return 'rate_limited';
  return 'http_error';
}

/** A body that answered nothing. Axios delivers an empty body as '' (G111). */
export function isEmptyBody(data: unknown): boolean {
  return data == null || data === '';
}

/** The outcome of an answered probe. Emptiness qualifies a 200 only. */
export function classifyProbeAnswer(status: number, data: unknown): Exclude<ProbeOutcome, 'no_response'> {
  const classified = classifyProbeStatus(status);
  return classified === 'ok' && isEmptyBody(data) ? 'empty_body' : classified;
}
