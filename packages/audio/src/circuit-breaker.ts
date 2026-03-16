/**
 * Generic circuit breaker for protecting against cascading failures.
 *
 * State machine:
 *   CLOSED  -- normal operation, calls pass through
 *   OPEN    -- too many failures, calls are rejected immediately
 *   HALF_OPEN -- cooldown expired, a single probe call is allowed
 *
 * After `maxFailures` consecutive failures in CLOSED state, the breaker
 * transitions to OPEN. After `cooldownMs` elapses it moves to HALF_OPEN
 * and permits one probe. If the probe succeeds the breaker resets to
 * CLOSED; if it fails it returns to OPEN.
 */

export type CircuitState = 'CLOSED' | 'HALF_OPEN' | 'OPEN';

export interface CircuitBreakerOptions {
  /** Duration in ms to remain OPEN before allowing a probe (default 5000). */
  cooldownMs?: number;
  /** Number of consecutive failures before transitioning to OPEN (default 10). */
  maxFailures?: number;
  /** Optional clock function for testing (returns epoch ms). */
  now?: () => number;
}

export interface CircuitHealth {
  consecutiveFailures: number;
  state: CircuitState;
  /** Epoch ms when the breaker last transitioned to OPEN, or undefined if it has never opened. */
  lastOpenedAt: number | undefined;
}

export class CircuitBreaker {
  private _consecutiveFailures = 0;
  private _lastOpenedAt: number | undefined;
  private _state: CircuitState = 'CLOSED';

  readonly cooldownMs: number;
  readonly maxFailures: number;
  private readonly clock: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.maxFailures = options.maxFailures ?? 10;
    this.cooldownMs = options.cooldownMs ?? 5_000;
    this.clock = options.now ?? Date.now;
  }

  /** Current breaker state (evaluates time-based OPEN -> HALF_OPEN transition). */
  get state(): CircuitState {
    if (this._state === 'OPEN' && this.cooldownElapsed()) {
      this._state = 'HALF_OPEN';
    }
    return this._state;
  }

  /** Number of consecutive failures recorded since the last success or reset. */
  get consecutiveFailures(): number {
    return this._consecutiveFailures;
  }

  /** Snapshot of the breaker's health. */
  health(): CircuitHealth {
    return {
      consecutiveFailures: this._consecutiveFailures,
      lastOpenedAt: this._lastOpenedAt,
      state: this.state,
    };
  }

  /**
   * Returns `true` if the call should be allowed through.
   * In OPEN state the call is rejected. In HALF_OPEN state a single probe
   * is permitted (the breaker transitions back to OPEN optimistically —
   * call {@link onSuccess} if the probe completes).
   */
  allowRequest(): boolean {
    const current = this.state; // triggers time-based transition
    switch (current) {
      case 'CLOSED':
        return true;
      case 'OPEN':
        return false;
      case 'HALF_OPEN':
        // Allow the probe but move to OPEN preemptively so that
        // concurrent calls during the probe are still rejected.
        // onSuccess() will reset to CLOSED if the probe works.
        this._state = 'OPEN';
        this._lastOpenedAt = this.clock();
        return true;
    }
  }

  /** Record a successful call — resets failure count and closes the breaker. */
  onSuccess(): void {
    this._consecutiveFailures = 0;
    this._state = 'CLOSED';
  }

  /** Record a failed call — increments failure count and may open the breaker. */
  onFailure(): void {
    this._consecutiveFailures++;
    if (this._consecutiveFailures >= this.maxFailures) {
      this._state = 'OPEN';
      this._lastOpenedAt = this.clock();
    }
  }

  /** Reset the breaker to its initial CLOSED state. */
  reset(): void {
    this._consecutiveFailures = 0;
    this._state = 'CLOSED';
    this._lastOpenedAt = undefined;
  }

  private cooldownElapsed(): boolean {
    if (this._lastOpenedAt === undefined) return false;
    return this.clock() - this._lastOpenedAt >= this.cooldownMs;
  }
}
