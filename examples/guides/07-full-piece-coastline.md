# 07 Full Piece Coastline

This is the largest example in the ladder: a local Tussel sketch inspired by the Strudel-style `coastline` piece, but constrained to the subset the current runtime already supports well.

## Files

- [script-ts](../code/07-full-piece-coastline/full-piece-coastline.script.ts)
- [scene-ts](../code/07-full-piece-coastline/full-piece-coastline.scene.ts)
- [scene-json](../code/07-full-piece-coastline/full-piece-coastline.scene.json)
- [local sample manifest](../assets/basic-kit/strudel.json)

## Run It

```bash
pnpm exec tussel check examples/code/07-full-piece-coastline/full-piece-coastline.script.ts
pnpm exec tussel run examples/code/07-full-piece-coastline/full-piece-coastline.script.ts --watch
pnpm exec tussel render examples/code/07-full-piece-coastline/full-piece-coastline.scene.ts --out ./full-piece-coastline.wav --seconds 12
```

## What To Notice

- The drums come from the local sample pack, while bass, keys, and melody use built-in synth voices.
- Motion comes from `fast`, `slow`, `mask`, `late`, and signal-driven `pan`, `lpf`, and `gain`.
- This is the example to copy when you want a longer local set that still stays compatible with the current `scene-ts` and `scene-json` conversion path.
