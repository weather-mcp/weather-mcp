/**
 * The CAP lifecycle filter shared by MeteoAlarm (`filterActiveWarnings`,
 * `src/services/meteoalarm.ts`) and the national CAP feeds
 * (`filterActiveCapWarnings`, `src/utils/capParse.ts`). Pure, zero imports:
 * it reads five alert-level fields both record types already carry, by
 * structural typing, so neither caller is imported and no cycle forms.
 *
 * Read-time only. Both services cache the **unfiltered** set and apply this
 * on every return, so a warning that expired, or was cancelled, after it was
 * cached is never served (G6).
 *
 * A `Cancel` that sits past a national feed's 200-item index cut never
 * reaches this filter. The renderer's trimmed-index disclosure covers that
 * case; this module adds no cap of its own (G8).
 */

/** The alert-level CAP fields the lifecycle rules read. */
export interface CapLifecycleFields {
  identifier: string;
  status?: string;
  msgType?: string;
  expires?: string;
  /** Identifiers already parsed out of the CAP `references` triples. */
  references: string[];
}

/**
 * The existing status test: an absent `status` reads as `Actual`, any other
 * value is a `Test`, `Exercise`, `System` or `Draft` message and is inert.
 */
function isActual(record: CapLifecycleFields): boolean {
  return record.status === undefined || record.status === 'Actual';
}

/**
 * The lifecycle pipeline, in this order:
 *  1. **Cancelled set.** Every `msgType === 'Cancel'` that passes the status
 *     test contributes its `references` — **whether or not the `Cancel`
 *     itself has expired.** A `Cancel` ends an alert; it is not a
 *     replacement with its own validity window, so gating it on its own
 *     `expires` would resurrect the cancelled alert until the original's
 *     expiry. A non-`Actual` `Cancel` retires nothing: a `Test` or `Exercise`
 *     cancellation that silenced a real warning would be a fabricated
 *     all-clear. A status-less `Cancel` retires, consistent with the status
 *     test treating an absent status as `Actual`.
 *  2. **Current.** Drop non-`Actual` status, drop every `Cancel` (it never
 *     renders), drop expired `expires` (unparseable or missing → keep).
 *  3. **Superseded set** from every *surviving* `msgType === 'Update'` —
 *     after expiry, so the references of an expired `Update` stay inert.
 *  4. Return current minus superseded minus cancelled.
 */
export function filterCapLifecycle<T extends CapLifecycleFields>(warnings: T[], now: Date): T[] {
  const cancelled = new Set<string>();
  for (const warning of warnings) {
    if (warning.msgType === 'Cancel' && isActual(warning)) {
      for (const identifier of warning.references) {
        cancelled.add(identifier);
      }
    }
  }

  const current = warnings.filter(warning => {
    if (!isActual(warning)) {
      return false;
    }
    if (warning.msgType === 'Cancel') {
      return false;
    }
    if (warning.expires) {
      const expires = new Date(warning.expires);
      if (!isNaN(expires.getTime()) && expires.getTime() <= now.getTime()) {
        return false;
      }
    }
    return true;
  });

  const superseded = new Set<string>();
  for (const warning of current) {
    if (warning.msgType === 'Update') {
      for (const identifier of warning.references) {
        superseded.add(identifier);
      }
    }
  }

  return current.filter(warning => !superseded.has(warning.identifier) && !cancelled.has(warning.identifier));
}
