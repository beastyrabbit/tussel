# Native Placeholder Task List

This is the concrete backlog for turning Tussel's current structural placeholders into native realtime semantics.

Current manual audio target:
- [manual coastline user-audio file](../examples/manual-audio/coastline.user-audio.script.ts)
- [original Strudel source](../examples/manual-listen/coastline.strudel.js)

## Harmonic transforms

- [ ] Implement `dict('ireal')` chord dictionary lookup with deterministic test fixtures.
- [ ] Implement `voicing()` so chord and note stacks produce voiced note events instead of passing through unchanged.
- [ ] Implement `set(pattern)` so numeric melody patterns can borrow pitches from another harmonic pattern.
- [ ] Implement `mode("root:g2")` with deterministic scale/mode expansion.
- [ ] Implement `offset()` as pitch transposition for `note`, `n`, and `chord`.
- [ ] Implement `anchor()` as harmonic register anchoring for melodic note material.

## Structural transforms

- [ ] Implement `chunk(size, transform)` with reference-backed event tests and audible parity fixtures.
- [ ] Implement `rarely(transform)` with deterministic gating behavior for offline and realtime runs.
- [ ] Implement `segment()` so patterns are resegmented instead of leaving the property as metadata only.
- [ ] Implement `size()` as a real master/space parameter or remove it from the native surface.

## Sample and playback shaping

- [ ] Implement `clip()` in native playback, not just as a stored property.
- [ ] Implement `shape()` as native waveshaping or amplitude shaping.
- [ ] Implement `delay()` as an actual audible delay line in the native audio graph.
- [ ] Implement `room()` as a real space/reverb effect in the native audio graph.
- [ ] Implement `phaser()` as an audible modulation effect.
- [ ] Implement `lpq()` as native filter-Q control paired with `lpf()`.
- [ ] Implement `fm()` as actual frequency modulation for synth voices.

## Instruments and sample compatibility

- [ ] Add a deterministic native fallback for `gm_epiano1:1`.
- [ ] Add a deterministic native fallback for `gm_acoustic_bass`.
- [ ] Add support for the `rd` / ride-style sample used in the original coastline source.
- [ ] Make remote pack aliases compatible with local fallback packs for live speaker tests.

## Audio focus and QA

- [ ] Keep silence as a hard failure for every admitted audio fixture.
- [ ] Require every new audible placeholder implementation to land with a 10+ second audio fixture.
- [ ] Add a dedicated coastline native-vs-reference parity fixture once the placeholder operators above are real.
