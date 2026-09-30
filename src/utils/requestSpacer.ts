/**
 * Reservation-based spacing of request starts.
 *
 * A caller reserves its start slot synchronously, then waits for the slot to
 * arrive. Reading the clock and writing the next free slot happen in one
 * synchronous run, so concurrent callers can never be handed the same slot.
 * The old shape (read the last-request time, sleep, write the time after the
 * sleep) let every caller that arrived during the sleep read the same stale
 * value and start together.
 *
 * A reservation alone spaces the *nominal* slots. When the event loop is
 * blocked past two deadlines, Node delivers both overdue timers in one turn,
 * so each waiter re-checks the last actual start on every wake and sleeps the
 * remainder (G122).
 */

export interface RequestSpacerDeps {
  /**
   * Clock in ms. Defaults to `performance.now`, a monotonic clock: only
   * differences between readings are compared, so the epoch is irrelevant and
   * a system-clock correction cannot stretch or shrink a wait.
   */
  now?: () => number;
  /** Sleep for `ms`. Defaults to a ref'd global `setTimeout`, looked up at call time. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Spaces request **starts** at least `minIntervalMs` apart.
 *
 * Spacing is on starts, not completions: a slow request does not delay the
 * next slot. The queue depth is unbounded by decision (design section 1,
 * which names the revisit trigger). The budget is whatever set of callers
 * share one instance. Pure and I/O-free apart from the injected clock and
 * sleep.
 *
 * Spacing is re-checked against the last actual start on every wake, so
 * overdue timers delivered in one turn cannot dispatch together. A sleep that
 * resolves without moving the clock is an injection error and rejects, rather
 * than spinning.
 */
export class RequestSpacer {
  private nextSlot = Number.NEGATIVE_INFINITY;
  /** Clock reading at which the most recent caller was released. */
  private lastStart = Number.NEGATIVE_INFINITY;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly minIntervalMs: number,
    deps: RequestSpacerDeps = {}
  ) {
    if (typeof minIntervalMs !== 'number' || !Number.isFinite(minIntervalMs) || minIntervalMs < 0) {
      throw new RangeError('RequestSpacer minIntervalMs must be a finite number >= 0');
    }
    this.now = deps.now ?? (() => performance.now());
    // The global is read when a sleep starts, never captured at module load,
    // so a spy installed later still sees the call. The timer is ref'd: the
    // wait is short and a caller is awaiting it.
    this.sleep =
      deps.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Reserve the next start slot synchronously; resolve when it arrives.
   * `onWait` runs synchronously, once, with the wait in ms, only when the
   * wait is greater than zero.
   *
   * Not `async`: the read of the clock and the write of `nextSlot` must be
   * one synchronous run, with no `await` above the write.
   */
  reserve(onWait?: (waitMs: number) => void): Promise<void> {
    const now = this.now();
    const slot = Math.max(now, this.nextSlot);
    this.nextSlot = slot + this.minIntervalMs;
    const wait = slot - now;
    if (wait <= 0) {
      this.release(now);
      return Promise.resolve();
    }
    onWait?.(wait);
    return this.sleep(wait).then(() => this.recheck(now));
  }

  /**
   * After a wake: release if a full interval has passed since the last actual
   * start, else sleep the remainder and look again. The read, the compare and
   * the record are one synchronous run, so a sibling woken in the same turn
   * sees the start just recorded. `onWait` is not called for these sleeps.
   */
  private recheck(before: number): Promise<void> {
    const now = this.now();
    if (now === before) {
      return Promise.reject(
        new Error('RequestSpacer: the injected sleep resolved without advancing the injected clock')
      );
    }
    const due = this.lastStart + this.minIntervalMs;
    if (now < due) {
      return this.sleep(due - now).then(() => this.recheck(now));
    }
    this.release(now);
    return Promise.resolve();
  }

  /** Record an actual start and keep later reservations behind it. */
  private release(now: number): void {
    this.lastStart = now;
    this.nextSlot = Math.max(this.nextSlot, now + this.minIntervalMs);
  }
}
