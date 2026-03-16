# Precision Impact Analysis

> Audit items 8.4 and 9.1 -- IEEE 754 double-precision timing in Tussel

## Why IEEE 754 Doubles (Not Rational Arithmetic)

Tussel uses JavaScript's native `number` type (IEEE 754 binary64) for all time
calculations. This was chosen over rational arithmetic (e.g., fraction pairs or
arbitrary-precision libraries) for the following reasons:

1. **Performance.** Pattern evaluation is the hot path. Every `queryPattern`,
   `transformFast`, and `transformSlow` call multiplies and divides time
   coordinates. Native float operations execute in a single CPU instruction;
   rational arithmetic would require heap allocations, GCD computations, and
   big-integer multiplication on every event.

2. **V8 optimization.** JavaScript engines optimize IEEE 754 doubles into
   unboxed machine registers. Rational types would force boxing, polymorphic
   inline caches, and GC pressure -- exactly the opposite of what a real-time
   audio scheduler needs.

3. **Sufficient precision.** As demonstrated by the tests in
   `packages/core/src/precision.test.ts`, the measured timing error is
   typically 0 to ~1e-10 across the entire operational envelope (up to cycle
   1,000,000 with 1000-event subdivisions). The conformance tolerance of
   5e-7 provides a 1000x safety margin over measured worst-case error.

4. **No accumulated drift.** The architecture avoids iterative accumulation
   entirely (see below), so the theoretical unbounded error growth of
   floating-point addition chains does not apply.

## Architecture: No Iterative Accumulation

The key design property that makes IEEE 754 doubles safe for Tussel is that
**time is never accumulated iteratively**. Both the pattern engine and the
scheduler use anchor-based positioning:

### Pattern Engine

The two core transforms are:

```
transformFast(target, begin, end, factor):
  events = queryPattern(target, begin * factor, end * factor)
  return events.map(e => ({ begin: e.begin / factor, end: e.end / factor }))

transformSlow(target, begin, end, factor):
  events = queryPattern(target, begin / factor, end / factor)
  return events.map(e => ({ begin: e.begin * factor, end: e.end * factor }))
```

Each event boundary undergoes exactly **one multiply and one divide**, regardless
of how many transforms are chained. There is no `position += step` loop that
would cause error to grow with iteration count.

The `querySequence` function computes slot positions as:
```
slotBegin = cycle + index * (1 / entries.length)
```
This is a single multiply-and-add, not an iterative sum.

### Scheduler

The scheduler computes cycle position from an anchor:
```
end = cycleAtCpsChange + (numTicksSinceCpsChange * windowDuration) * cps
```

This is a **multiplicative** computation from a fixed anchor point, not
`lastEnd += deltaTime * cps`. The `numTicksSinceCpsChange` counter is an
integer (exact), and the rest is a two-step multiply, so error is bounded
by 2-3 ULPs of the result regardless of how many ticks have elapsed.

## Measured Precision

The following measurements are from the test suite in
`packages/core/src/precision.test.ts` (sections 9-13):

### Pattern Timing Error by Cycle Count

| Cycle Offset | Pattern        | Max Error (absolute) | ULPs at 1.0      |
|-------------|----------------|---------------------|-------------------|
| 0           | seq(4)         | 0                   | 0                 |
| 1,000       | seq(4)         | ~1e-16              | ~0.5              |
| 1,000,000   | seq(4)         | ~1e-10              | ~450              |
| 1,000,000   | seq(7) (prime) | ~1e-10              | ~450              |
| 1,000,000   | seq(16)        | ~1e-10              | ~450              |
| 1,000,000   | fast(7)        | ~1e-10              | ~450              |

All measurements are well below the conformance tolerance of 5e-7.

### Chained Transform Error

| Chain                             | Max Error vs Direct | Notes                          |
|-----------------------------------|--------------------:|--------------------------------|
| fast(3).fast(5).fast(7) vs fast(105) | ~1e-16          | Chained multiply vs single     |
| fast(N).slow(N) x4 depth         | ~1e-16              | Identity chain, no degradation |
| fast(1000) across 1000 events    | ~1e-16              | Single transform, many events  |

Error does **not** grow with chain depth, confirming the non-iterative
architecture.

### Scheduler Tick Error

| Ticks   | CPS   | Max Error | Notes                            |
|---------|-------|-----------|----------------------------------|
| 10,000  | 0.5   | 0         | Exact (all factors are dyadic)   |
| 100,000 | 1/3   | ~2e-13    | Non-dyadic CPS, single multiply  |
| 1,000,000 | 1/3 | ~2e-13    | Same error -- no accumulation    |

## When Precision Breaks Down

### The Precision Cliff

IEEE 754 doubles have 52 bits of mantissa. For a number near `base`, the
unit of least precision (ULP) is:

```
ULP(base) = 2^(floor(log2(base)) - 52)
```

The conformance tolerance is 5e-7. Precision breaks down when `ULP(base) > 5e-7`:

| Cycle Count | ULP            | Within 6-digit tolerance? |
|-------------|----------------|--------------------------|
| 1,000       | ~1.1e-13       | Yes (5 orders of margin) |
| 1,000,000   | ~1.2e-10       | Yes (3 orders of margin) |
| 1,000,000,000 (1B) | ~1.2e-7 | Yes (marginal)          |
| 4,294,967,296 (2^32) | ~9.5e-7 | **Boundary** -- positions may exceed tolerance |
| 10,000,000,000 (10B) | ~1.9e-6 | **No** -- absolute positions lose precision |

**Key observation:** Even when absolute positions lose precision at very high
cycle counts, **relative durations remain precise**. This is because duration
is computed as `end - begin`, and the subtraction cancels the large integer
part, leaving only the fractional difference which has full double precision.

At typical musical tempos (CPS = 0.5 to 4), reaching 2^32 cycles would take:
- At CPS 0.5: ~272 years
- At CPS 1: ~136 years
- At CPS 4: ~34 years

This is far beyond any realistic playback session.

### Compensating Measures

1. **Anchor-based positioning.** The scheduler resets its anchor
   (`cycleAtCpsChange`, `secondsAtCpsChange`) on every CPS change, keeping
   the multiplicand small.

2. **Cycle-local computation.** `querySequence` uses `Math.floor(begin)` to
   find the integer cycle, then computes fractional positions relative to
   that cycle. This keeps the fractional parts small even at large cycle counts.

3. **No rounding at cycle boundaries.** Unlike some implementations that
   round event times to a grid, Tussel preserves the full double-precision
   result. This avoids quantization artifacts and is safe because the error
   budget (5e-7) provides ample margin over actual error (~1e-10 at 1M cycles).

## Decision

The current approach -- IEEE 754 doubles with 6-digit conformance tolerance
(5e-7) -- is **justified and appropriate** for the following reasons:

- Measured error is typically 3+ orders of magnitude below the tolerance
- The non-iterative architecture prevents error accumulation
- Precision holds for well over 100 years of continuous playback at any
  reasonable tempo
- Relative durations (which matter for audio output) remain precise even at
  extreme cycle counts
- The performance benefit over rational arithmetic is substantial and
  necessary for real-time audio

No changes to the tolerance or arithmetic approach are needed.
