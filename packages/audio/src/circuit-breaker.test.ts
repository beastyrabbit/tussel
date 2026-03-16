import { describe, expect, it } from 'vitest';
import { CircuitBreaker } from './circuit-breaker.js';

describe('CircuitBreaker', () => {
  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  it('starts in CLOSED state with zero failures', () => {
    const cb = new CircuitBreaker();
    expect(cb.state).toBe('CLOSED');
    expect(cb.consecutiveFailures).toBe(0);
  });

  it('uses sensible defaults for maxFailures and cooldownMs', () => {
    const cb = new CircuitBreaker();
    expect(cb.maxFailures).toBe(10);
    expect(cb.cooldownMs).toBe(5_000);
  });

  it('accepts custom maxFailures and cooldownMs', () => {
    const cb = new CircuitBreaker({ maxFailures: 3, cooldownMs: 1_000 });
    expect(cb.maxFailures).toBe(3);
    expect(cb.cooldownMs).toBe(1_000);
  });

  // ---------------------------------------------------------------------------
  // CLOSED state behavior
  // ---------------------------------------------------------------------------

  it('allows requests in CLOSED state', () => {
    const cb = new CircuitBreaker();
    expect(cb.allowRequest()).toBe(true);
  });

  it('stays CLOSED while failures are below threshold', () => {
    const cb = new CircuitBreaker({ maxFailures: 5 });
    for (let i = 0; i < 4; i++) {
      cb.onFailure();
    }
    expect(cb.state).toBe('CLOSED');
    expect(cb.consecutiveFailures).toBe(4);
    expect(cb.allowRequest()).toBe(true);
  });

  it('resets failure count on success', () => {
    const cb = new CircuitBreaker({ maxFailures: 5 });
    cb.onFailure();
    cb.onFailure();
    cb.onFailure();
    cb.onSuccess();
    expect(cb.consecutiveFailures).toBe(0);
    expect(cb.state).toBe('CLOSED');
  });

  // ---------------------------------------------------------------------------
  // CLOSED -> OPEN transition
  // ---------------------------------------------------------------------------

  it('transitions to OPEN after maxFailures consecutive failures', () => {
    const cb = new CircuitBreaker({ maxFailures: 3 });
    cb.onFailure();
    cb.onFailure();
    expect(cb.state).toBe('CLOSED');
    cb.onFailure();
    expect(cb.state).toBe('OPEN');
    expect(cb.consecutiveFailures).toBe(3);
  });

  it('rejects requests in OPEN state', () => {
    const cb = new CircuitBreaker({ maxFailures: 2 });
    cb.onFailure();
    cb.onFailure();
    expect(cb.allowRequest()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Cooldown behavior: OPEN -> HALF_OPEN
  // ---------------------------------------------------------------------------

  it('remains OPEN before cooldown elapses', () => {
    let now = 1000;
    const cb = new CircuitBreaker({ maxFailures: 2, cooldownMs: 500, now: () => now });
    cb.onFailure();
    cb.onFailure();
    expect(cb.state).toBe('OPEN');

    now += 499;
    expect(cb.state).toBe('OPEN');
  });

  it('transitions to HALF_OPEN after cooldown elapses', () => {
    let now = 1000;
    const cb = new CircuitBreaker({ maxFailures: 2, cooldownMs: 500, now: () => now });
    cb.onFailure();
    cb.onFailure();
    expect(cb.state).toBe('OPEN');

    now += 500;
    expect(cb.state).toBe('HALF_OPEN');
  });

  // ---------------------------------------------------------------------------
  // HALF_OPEN: probe behavior
  // ---------------------------------------------------------------------------

  it('allows a single probe request in HALF_OPEN state', () => {
    let now = 1000;
    const cb = new CircuitBreaker({ maxFailures: 2, cooldownMs: 100, now: () => now });
    cb.onFailure();
    cb.onFailure();
    now += 100;

    expect(cb.state).toBe('HALF_OPEN');
    expect(cb.allowRequest()).toBe(true);
  });

  it('transitions back to OPEN while probe is in-flight (prevents concurrent probes)', () => {
    let now = 1000;
    const cb = new CircuitBreaker({ maxFailures: 2, cooldownMs: 100, now: () => now });
    cb.onFailure();
    cb.onFailure();
    now += 100;

    // First call is the probe — allowed
    expect(cb.allowRequest()).toBe(true);
    // Immediately after, state should be OPEN to block concurrent calls
    // (the cooldown just restarted)
    expect(cb.allowRequest()).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // HALF_OPEN -> CLOSED (probe success)
  // ---------------------------------------------------------------------------

  it('transitions to CLOSED when probe succeeds', () => {
    let now = 1000;
    const cb = new CircuitBreaker({ maxFailures: 2, cooldownMs: 100, now: () => now });
    cb.onFailure();
    cb.onFailure();
    now += 100;

    expect(cb.allowRequest()).toBe(true); // probe
    cb.onSuccess();
    expect(cb.state).toBe('CLOSED');
    expect(cb.consecutiveFailures).toBe(0);
    expect(cb.allowRequest()).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // HALF_OPEN -> OPEN (probe failure)
  // ---------------------------------------------------------------------------

  it('transitions back to OPEN when probe fails', () => {
    let now = 1000;
    const cb = new CircuitBreaker({ maxFailures: 2, cooldownMs: 100, now: () => now });
    cb.onFailure();
    cb.onFailure();
    now += 100;

    expect(cb.allowRequest()).toBe(true); // probe
    cb.onFailure();
    // Still OPEN since failure count is now 3 (>= maxFailures of 2)
    expect(cb.state).toBe('OPEN');
  });

  // ---------------------------------------------------------------------------
  // Full cycle: CLOSED -> OPEN -> HALF_OPEN -> CLOSED
  // ---------------------------------------------------------------------------

  it('completes a full state machine cycle', () => {
    let now = 0;
    const cb = new CircuitBreaker({ maxFailures: 3, cooldownMs: 200, now: () => now });

    // CLOSED
    expect(cb.state).toBe('CLOSED');
    cb.onFailure();
    cb.onFailure();
    cb.onFailure();

    // OPEN
    expect(cb.state).toBe('OPEN');
    expect(cb.allowRequest()).toBe(false);

    // Wait for cooldown
    now += 200;

    // HALF_OPEN
    expect(cb.state).toBe('HALF_OPEN');
    expect(cb.allowRequest()).toBe(true); // probe

    // Probe succeeds
    cb.onSuccess();
    expect(cb.state).toBe('CLOSED');
    expect(cb.consecutiveFailures).toBe(0);
    expect(cb.allowRequest()).toBe(true);
  });

  it('completes a cycle where the probe fails then eventually succeeds', () => {
    let now = 0;
    const cb = new CircuitBreaker({ maxFailures: 2, cooldownMs: 100, now: () => now });

    // Fill to OPEN
    cb.onFailure();
    cb.onFailure();
    expect(cb.state).toBe('OPEN');

    // First probe attempt fails
    now += 100;
    expect(cb.allowRequest()).toBe(true);
    cb.onFailure();
    expect(cb.state).toBe('OPEN');

    // Second probe attempt succeeds
    now += 100;
    expect(cb.allowRequest()).toBe(true);
    cb.onSuccess();
    expect(cb.state).toBe('CLOSED');
  });

  // ---------------------------------------------------------------------------
  // health() method
  // ---------------------------------------------------------------------------

  it('returns a health snapshot', () => {
    const cb = new CircuitBreaker({ maxFailures: 3 });
    const h1 = cb.health();
    expect(h1.state).toBe('CLOSED');
    expect(h1.consecutiveFailures).toBe(0);
    expect(h1.lastOpenedAt).toBeUndefined();

    cb.onFailure();
    cb.onFailure();
    cb.onFailure();
    const h2 = cb.health();
    expect(h2.state).toBe('OPEN');
    expect(h2.consecutiveFailures).toBe(3);
    expect(h2.lastOpenedAt).toBeTypeOf('number');
  });

  // ---------------------------------------------------------------------------
  // reset()
  // ---------------------------------------------------------------------------

  it('resets to initial CLOSED state', () => {
    const cb = new CircuitBreaker({ maxFailures: 2 });
    cb.onFailure();
    cb.onFailure();
    expect(cb.state).toBe('OPEN');

    cb.reset();
    expect(cb.state).toBe('CLOSED');
    expect(cb.consecutiveFailures).toBe(0);
    expect(cb.health().lastOpenedAt).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  it('interleaved successes prevent the breaker from opening', () => {
    const cb = new CircuitBreaker({ maxFailures: 3 });
    cb.onFailure();
    cb.onFailure();
    cb.onSuccess(); // resets
    cb.onFailure();
    cb.onFailure();
    cb.onSuccess(); // resets again
    expect(cb.state).toBe('CLOSED');
    expect(cb.consecutiveFailures).toBe(0);
  });

  it('handles maxFailures of 1', () => {
    const cb = new CircuitBreaker({ maxFailures: 1 });
    cb.onFailure();
    expect(cb.state).toBe('OPEN');
  });

  it('cooldown of 0 transitions to HALF_OPEN immediately', () => {
    const now = 1000;
    const cb = new CircuitBreaker({ maxFailures: 1, cooldownMs: 0, now: () => now });
    cb.onFailure();
    // cooldownMs is 0 so it should transition to HALF_OPEN immediately
    expect(cb.state).toBe('HALF_OPEN');
  });
});
