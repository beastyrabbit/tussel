# Audit Remediation Checklist

This checklist turns the March 13, 2026 audit into concrete repo-local tasks. Each item maps back to the audit numbering so implementation can proceed in batches without losing scope.

Related docs:
- [Docs Index](./README.md)
- [Native Placeholder Task List](./native-placeholder-task-list.md)

Status:
- `[ ]` not started
- `[/]` in progress
- `[x]` landed in this repo state
- `[-]` intentionally out of scope for the current terminal-only product

## P0 Now

- [x] 1.2.2 Implement audible `room()` reverb in the audio engine.
- [x] 1.2.3 Implement audible `size()` routing for reverb sizing.
- [x] 1.2.1 Implement audible `delay()` in the audio engine.
- [x] 5.1 Surface unsupported pattern methods with runtime warnings instead of silent pass-through.
- [x] 5.2 Surface unsupported pattern calls with runtime warnings instead of silent empty output.
- [/] 6.2 Add real audio-engine unit tests for oscillators, envelopes, filters, pan, samples, gain, WAV output, and render consistency.
- [x] 8.1 Fix `compare-audio` so matching silent renders do not fail parity automatically.
- [x] 12.2 Add CI configuration to run lint, typecheck, tests, and parity smoke coverage.

## P1 Next

- [x] 1.9 Implement conditional modifiers (`when`, `every`, `sometimes`, `often`, `rarely`, `almostNever`, `almostAlways`).
- [x] 1.11 Implement missing time modifiers (`compress`, `linger`, `zoom`, `within`, `hurry`, `fastGap`, `slowGap`).
  - Implemented: `compress`, `linger`, `zoom`, `within`, `hurry`, `fastGap`.
  - `slowGap` is supported as a compatibility alias to `fastGap`; the upstream reference surface only exposes `fastGap` / `densityGap`.
- [x] 1.13 Implement accumulation patterns (`superimpose`, `off`, `jux`, `juxBy`, `layer`).
- [x] 1.10 Implement random modifiers (`shuffle`, `scramble`, `degradeBy`, `sometimesBy`, `degrade`).
  - Implemented: `shuffle`, `scramble`, `degrade`, `degradeBy`, `sometimesBy`.
- [x] 9.2 Implement an audio bus/orbit routing system.
- [/] 6.3 Add scheduler multi-tick, timing, CPS-change, hot-swap, and stability tests.
- [x] 1.2.8 Wire `lpq()` to `BiquadFilterNode.Q`.
- [x] 4.7 Support negative `speed` for reverse sample playback.

## Feature Gaps

- [ ] 1.1 Implement Csound integration: `loadOrc()`, `loadCsound()`, `.csound()`, `.csoundm()`, runtime support, instrument loading, p-value passing, and tests.
- [x] 1.2.4 Implement audible `shape()` distortion.
- [x] 1.2.5 Implement audible `phaser()`.
- [x] 1.2.6 Implement real `orbit` routing instead of metadata-only behavior.
- [x] 1.2.7 Implement audible `fm()` synthesis routing.
- [x] 1.2.9 Give `hcutoff` distinct alias behavior instead of raw duplication.
- [x] 1.2.10 Give `cutoff` distinct alias behavior instead of raw duplication.
- [ ] 1.3 Implement Hydra visual integration.
- [ ] 1.4 Implement MIDI, OSC, gamepad, and device-motion input/output support.
- [ ] 1.5 Implement xenharmonic tuning, microtonal, Xen, and EDO support.
- [x] 1.6 Implement tonal theory features including `scale()`, chord voicing helpers, and tonal utilities.
- [/] 1.7 Implement stepwise notation support (`step`, `stepcat`, and related helpers).
  - Implemented: `stepcat`, `stepalt`, `pace`, `expand`, `contract`, `extend`, `take`, `drop`, `shrink`, `grow`, `tour`, `zip`, `^`-driven alternate step counting in mini step inference, and step-aware `polymeter`.
  - Remaining: a dedicated `step()` helper if parity demands it, and broader/full learning-page parity coverage beyond the representative slice.
- [ ] 1.8 Implement mondo notation parser/evaluator to move beyond the current ~1/17 passing state.
- [x] 1.12 Implement `cosine` signal evaluation in core.
- [/] 1.14 Implement factory functions (`polymeter`, `polyrhythm`, `register`, `choose`, `wchoose`, `sequence`).
- [ ] 1.15 Define real `.color()` / visual-feedback semantics or remove parity claims for them.
- [-] 1.16 Keep PWA support out of scope unless Tussel stops being terminal-daemon-first.

## Placeholder And Stub Removal

- [x] 2.1 Replace the stubbed Tidal case registry in `packages/parity/src/adapters/tidal-cases.ts`.
- [x] 2.2 Make `PatternBuilder.log()` perform observable debug output.
- [x] 2.3 Make `String.prototype.log` perform observable debug output.
- [x] 2.4 Treat `setcpm()` as a runtime state call during script transformation.

## Declared-But-Not-Implemented Pattern Methods

- [x] 3.1 Implement `anchor()` or reject it explicitly.
- [x] 3.2 Implement `ceil()` or reject it explicitly.
- [x] 3.3 Implement `chunk()` or reject it explicitly.
- [/] 3.4 Implement `dict()` or reject it explicitly.
- [x] 3.5 Implement `floor()` or reject it explicitly.
- [x] 3.6 Implement `offset()` or reject it explicitly.
- [x] 3.7 Implement `rarely()` or reject it explicitly.
- [x] 3.8 Implement `round()` or reject it explicitly.
- [x] 3.9 Implement `segment()` or reject it explicitly.
- [x] 3.10 Implement `voicing()` or reject it explicitly.

## Audio Engine Deficiencies

- [ ] 4.1 Wire every declared audio property to actual nodes in `connectOutputChain()`.
- [x] 4.2 Add a real reverb implementation.
- [x] 4.3 Add a real delay implementation.
- [ ] 4.4 Replace hardcoded audio constants with documented configuration.
- [x] 4.5 Generate stereo noise instead of a mono noise buffer.
- [x] 4.6 Add loop parameter support for sample playback.
- [x] 4.7 Support reverse playback from negative `speed`.

## Silent-Failure And Error-Handling Work

- [ ] 5.3 Add structured error reporting for audio trigger failures beyond `console.error`.
- [ ] 5.4 Decide whether missing samples should fail scenes, trip a budget, or remain warnings with structured reporting.
- [ ] 5.5 Stop silently falling back to sinkless realtime audio without a surfaced diagnostic.
- [x] 10.3 Add input validation for `queryScene()`, `renderSceneToWavBuffer()`, `Scheduler.setCps()`, and `defineScene()`.
- [ ] 10.4 Unify error handling across core, audio, runtime, and parity packages.
- [ ] 9.6 Add runtime error boundaries / recovery / circuit-breaker behavior.

## Test Coverage Expansion

- [ ] 6.1 Add meaningful tests for `@tussel/ir`.
- [ ] 6.1 Add deeper test coverage for `@tussel/mini`.
- [ ] 6.1 Add deeper test coverage for `@tussel/core`.
- [ ] 6.1 Add deeper test coverage for `@tussel/dsl`.
- [ ] 6.1 Add deeper test coverage for `@tussel/audio`.
- [ ] 6.1 Add deeper test coverage for `@tussel/runtime`.
- [ ] 6.1 Add tests for `@tussel/cli`.
- [ ] 6.1 Add tests for `@tussel/testkit`.
- [ ] 6.1 Expand parity beyond comparative happy-path coverage.

### Audio Tests

- [ ] 6.2 Test oscillator waveform correctness.
- [ ] 6.2 Test ADSR envelope shape.
- [ ] 6.2 Test filter frequency response.
- [ ] 6.2 Test pan accuracy.
- [ ] 6.2 Test sample playback timing.
- [ ] 6.2 Test sample speed and pitch shifting.
- [ ] 6.2 Test cut-group behavior.
- [ ] 6.2 Test gain scaling linearity.
- [ ] 6.2 Test WAV encoding correctness.
- [ ] 6.2 Test offline vs realtime consistency.
- [ ] 6.2 Test multiple simultaneous voices.
- [ ] 6.2 Test sample-rate handling.
- [ ] 6.2 Test overflow and underflow edge cases.

### Scheduler Tests

- [x] 6.3 Test event timing accuracy over multiple ticks.
- [x] 6.3 Test CPS changes mid-playback.
- [x] 6.3 Test scene hot-swap during playback.
- [ ] 6.3 Test window / overlap / latency effects.
- [ ] 6.3 Test long-running drift and stability.
- [x] 6.3 Test `cps = 0` and negative CPS behavior.
- [x] 6.3 Test empty scenes.
- [x] 6.3 Test scenes with only muted channels.
- [ ] 6.3 Test concurrent tick handling.

### Core Engine Tests

- [ ] 6.4 Test `stack` composition.
- [ ] 6.4 Test `fast` transforms.
- [ ] 6.4 Test `slow` transforms.
- [ ] 6.4 Test `early` shifts.
- [ ] 6.4 Test `late` shifts.
- [ ] 6.4 Test `ply` repetition.
- [ ] 6.4 Test `rev` reversal.
- [ ] 6.4 Test `mask` / `struct` filtering.
- [ ] 6.4 Test signal evaluation across `sine`, `tri`, `square`, `rand`, and `perlin`.
- [ ] 6.4 Test signal arithmetic operators.
- [ ] 6.4 Test nested pattern composition.
- [ ] 6.4 Test negative cycle ranges.
- [ ] 6.4 Test very large cycle numbers and precision behavior.
- [ ] 6.4 Test empty patterns.
- [ ] 6.4 Test patterns with rests.
- [ ] 6.4 Test property annotation paths.
- [ ] 6.4 Test `clip` interaction with duration.
- [ ] 6.4 Test `evaluateMiniNumber()` edge cases.
- [ ] 6.4 Test `coerceMiniValue()` edge cases.
- [ ] 6.4 Test `isTruthyMaskValue()` edge cases.

### Mini Parser Tests

- [ ] 6.5 Test nested groups.
- [ ] 6.5 Test deep nesting.
- [ ] 6.5 Test division operator `/`.
- [ ] 6.5 Test multiplication by non-integers.
- [ ] 6.5 Test empty input.
- [ ] 6.5 Test malformed input errors.
- [ ] 6.5 Test Unicode input.
- [ ] 6.5 Test very long patterns.
- [ ] 6.5 Test deeply nested Euclidean rhythms.
- [ ] 6.5 Test Euclidean rotation parameter `a(3,8,1)`.
- [ ] 6.5 Test top-level comma-separated stacks.
- [ ] 6.5 Test colon variants like `bd:2`.
- [ ] 6.5 Test decimal pattern weights.

### DSL Tests

- [ ] 6.6 Test deeper `PatternBuilder` chaining.
- [ ] 6.6 Test `SignalBuilder` operations.
- [ ] 6.6 Test `createParam()` and `createParams()`.
- [ ] 6.6 Test `SceneRecorder` state management.
- [ ] 6.6 Test string-prototype patching behavior.
- [x] 6.6 Test invalid `defineScene()` input.
- [ ] 6.6 Test `normalizeValue()` with complex nesting.
- [x] 6.6 Test `scene()` helper behavior.
- [x] 6.6 Test `silence()`.
- [ ] 6.6 Test all exported signal constants.

## Learning-Page Parity

- [ ] 7.1 Execute and validate `learn/mini-notation`.
- [ ] 7.2 Execute and validate `learn/mondo-notation`.
- [ ] 7.3 Execute and validate `learn/sounds`.
- [ ] 7.4 Execute and validate `learn/samples`.
- [ ] 7.5 Execute and validate `learn/notes`.
- [ ] 7.6 Execute and validate `learn/synths`.
- [ ] 7.7 Execute and validate `learn/effects`.
- [ ] 7.8 Execute and validate `learn/code`.
- [ ] 7.9 Execute and validate `learn/csound`.
- [ ] 7.10 Execute and validate `learn/xen`.
- [ ] 7.11 Execute and validate `learn/tonal`.
- [/] 7.12 Execute and validate `learn/stepwise`.
  - Representative extraction/import/query coverage is now in `packages/parity/src/learning-pages.test.ts`.
  - Remaining: broader/full page parity execution rather than a representative slice.
- [ ] 7.13 Execute and validate `learn/hydra`.
- [ ] 7.14 Execute and validate `learn/input-output`.
- [ ] 7.15 Execute and validate `learn/visual-feedback`.
- [ ] 7.16 Execute and validate `learn/faq`.
- [ ] 7.17 Execute and validate `learn/getting-started`.
- [ ] 7.18 Execute and validate `learn/strudel-vs-tidal`.
- [ ] 7.19 Execute and validate `functions/intro`.
- [ ] 7.20 Execute and validate `functions/value-modifiers`.
- [ ] 7.21 Add parity coverage for `learn/accumulation`.
- [ ] 7.22 Add parity coverage for `learn/conditional-modifiers`.
- [ ] 7.23 Add parity coverage for `learn/random-modifiers`.
- [ ] 7.24 Add parity coverage for `learn/time-modifiers`.
- [ ] 7.25 Add parity coverage for `learn/signals`.
- [ ] 7.26 Add parity coverage for `learn/factories`.
- [ ] 7.27 Add parity coverage for `learn/colors`.
- [ ] 7.28 Add parity coverage for `learn/metadata`.
- [ ] 7.29 Add parity coverage for `learn/input-devices`.
- [ ] 7.30 Add parity coverage for `learn/devicemotion`.
- [-] 7.31 Leave `learn/pwa` parity coverage out of scope while Tussel is terminal-only.
- [ ] 7.32 Add roundtrip tests per learning page.
- [ ] 7.33 Add native DSL tests per learning page.
- [ ] 7.34 Add edge-case tests per learning page feature set.

## Wrong Or Suspicious Tests

- [x] 8.2 Stop filtering out `createParam()` / `createParams()` parity cases silently.
- [x] 8.3 Make `learning-pages.test.ts` execute extracted examples instead of only counting them.
- [ ] 8.4 Justify or revise the float-precision tolerance used in core conformance tests.
- [x] 8.5 Replace one-tick fake scheduler interval coverage with real multi-tick assertions.
- [ ] 8.6 Add waveform-content assertions to audio tests.

## Architecture Work

- [ ] 9.1 Add fraction-based timing or publish a precision-impact decision with compensating tests.
- [ ] 9.3 Remove or isolate `String.prototype` pollution.
- [ ] 9.4 Replace unsafe `as unknown as ...` type escapes with proper typings.
- [ ] 9.5 Make scheduler state mutation safe with async `onTrigger` handlers.
- [ ] 9.7 Remove CWD-relative path assumptions from sample-pack and cache defaults.

## Code Quality Work

- [ ] 10.1 Document or centralize magic numbers.
- [x] 10.2 Deduplicate `detectCps()`.
- [x] 10.2 Deduplicate `describeSnippet()`.
- [x] 10.2 Consolidate duplicate `clampNumber()` helpers.

## Parity-Suite Gaps

- [ ] 11.1 Add negative parity fixtures for invalid scenes, malformed notation, and resource constraints.
- [ ] 11.2 Rebalance level distribution toward more level-5 / real-world fixtures.
- [ ] 11.3 Pin the Strudel reference to a recorded version or commit.
- [ ] 11.4 Add parity tolerance mode using RMS / max-delta thresholds instead of exact PCM only.

## Dependency, Build, And Docs

- [ ] 12.1 Add integration confidence around `node-web-audio-api` across supported Node versions.
- [ ] 12.3 Make the Strudel reference checkout reproducible.
- [ ] 13.1 Add API documentation and package-level READMEs.
- [ ] 13.2 Reconcile plan promises with tested command/import/check behavior.
- [ ] 15.1 Work through the remaining priority action items in order and retire this checklist as items land.
