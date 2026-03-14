# Native Placeholder Task List

This is the concrete backlog for turning Tussel's current structural placeholders into native realtime semantics.

Current manual audio target:
- [manual coastline user-audio file](../examples/manual-audio/coastline.user-audio.script.ts)
- [original Strudel source](../examples/manual-listen/coastline.strudel.js)

## Completed

The following features from the original backlog are now implemented:

- [x] `dict('ireal')` chord dictionary lookup — consumed by `applyVoicing()` in core
- [x] `voicing()` chord expansion — implemented in `applyVoicing()` in core
- [x] `set(pattern)` pitch borrowing — implemented in `applySet()` in core
- [x] `mode("root:g2")` scale/mode expansion — consumed by `applyVoicing()` in core
- [x] `offset()` pitch transposition — implemented in `applyOffset()` in core
- [x] `anchor()` harmonic register anchoring — consumed by `applyScale()` and `applyVoicing()` in core
- [x] `chunk(size, transform)` — implemented in `applyChunk()` in core
- [x] `rarely(transform)` — maps to `sometimesBy(0.25, ...)` in DSL
- [x] `segment()` resegmentation — implemented in `applySegment()` in core
- [x] `clip()` playback duration scaling — applied in `buildVoice()` in audio
- [x] `shape()` waveshaping — applied via WaveShaperNode in `connectOutputChain()` in audio
- [x] `delay()` delay line — implemented in `connectOutputChain()` in audio
- [x] `room()` reverb/convolution — implemented in `connectOutputChain()` in audio
- [x] `phaser()` modulation effect — implemented in `connectOutputChain()` in audio
- [x] `lpq()` filter Q control — applied alongside `lpf()` in `connectOutputChain()` in audio
- [x] `fm()` frequency modulation — implemented in `playSynth()` in audio

## Remaining work

### Instruments and sample compatibility

- [ ] Add a deterministic native fallback for `gm_epiano1:1`.
- [ ] Add a deterministic native fallback for `gm_acoustic_bass`.
- [ ] Add support for the `rd` / ride-style sample used in the original coastline source.
- [ ] Make remote pack aliases compatible with local fallback packs for live speaker tests.

### Unimplemented features (from plan but not yet started)

- [ ] Csound actual synthesis — IR and DSL exist but `playCsound()` uses preset-based Web Audio fallbacks, not real Csound
- [ ] Hydra visual rendering — DSL and metadata storage exist but no visual pipeline
- [x] MIDI port I/O — MidiOutputManager dispatches note/CC events to hardware ports via `@julusian/midi`
- [x] OSC network I/O — OscOutputManager sends OSC messages via UDP sockets
- [ ] Gamepad/DeviceMotion input — DSL methods exist but inputs are not connected to device APIs
- [ ] Xenharmonic/microtonal tuning — EDO frequency/ratio support exists in core, DSL surface (`tune()`, `getFreq()`, `i()`) not started
- [x] Mondo notation — parser implemented in `@tussel/mini`, evaluator wired into core engine (`case 'mondo'`)

### Audio QA

- [ ] Keep silence as a hard failure for every admitted audio fixture.
- [ ] Require every new audible placeholder implementation to land with a 10+ second audio fixture.
- [ ] Add a dedicated coastline native-vs-reference parity fixture once remaining operators are real.
