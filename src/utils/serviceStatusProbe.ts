/**
 * What one check_service_status probe observed, and the status → outcome mapping
 * both probes share.
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

export type ProbeOutcome = 'ok' | 'rate_limited' | 'http_error' | 'no_response';

/**
 * `operational` is `outcome === 'ok'`; it exists for the handler's both-up test.
 * `httpStatus` is present for every outcome but `no_response`.
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
