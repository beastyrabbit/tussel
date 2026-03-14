# Worked Coastline-Style Example

This is the reference guide for the largest shipped example: a local Tussel piece shaped after the feel of a Strudel/Tidal sketch, but kept inside the subset the current runtime handles well.

## Files

- [script-ts](../examples/code/07-full-piece-coastline/full-piece-coastline.script.ts)
- [scene-ts](../examples/code/07-full-piece-coastline/full-piece-coastline.scene.ts)
- [scene-json](../examples/code/07-full-piece-coastline/full-piece-coastline.scene.json)
- [example guide](../examples/guides/07-full-piece-coastline.md)
- [local sample manifest](../examples/assets/basic-kit/strudel.json)

## Run It

```bash
pnpm exec tussel check examples/code/07-full-piece-coastline/full-piece-coastline.script.ts
pnpm exec tussel run examples/code/07-full-piece-coastline/full-piece-coastline.script.ts --watch
pnpm exec tussel render examples/code/07-full-piece-coastline/full-piece-coastline.scene.ts --out ./full-piece-coastline.wav --seconds 12
```

## How It Is Built

- `samples('./examples/assets/basic-kit')` keeps the kit local and deterministic.
- `setcps(0.75)` sets the transport once at the top level.
- `groove` and `shuffle` handle the sample-backed drum layers.
- `bass`, `keys`, and `melody` use built-in synth voices and structural modulation.
- The final `scene({...})` gives named channels so conversion stays clean.

## Why This Example Matters

- It is long enough to feel like a real set sketch.
- It exercises both sample playback and synth playback.
- It survives conversion to `scene-ts` and `scene-json`.
- It is the best current template for writing larger local pieces in this repo.

## What It Does Not Try To Fake

This example is intentionally simpler than the aspirational Strudel source style you described earlier.

Current gaps include:

- no full chord-dictionary and voicing workflow parity
- no full `mode` and `set` harmony pipeline parity
- no guarantee that transforms like `chunk` or `rarely` match Strudel/Tidal semantics yet
- no visuals or editor integration here

Use this example as the current working ceiling for the implemented local runtime, not as the final language boundary.
