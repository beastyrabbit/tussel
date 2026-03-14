# 01 First Sound

Start here if you want the smallest complete Tussel scene that still uses the real daemon flow.

## Files

- [script-ts](../code/01-first-sound/first-sound.script.ts)
- [scene-ts](../code/01-first-sound/first-sound.scene.ts)
- [scene-json](../code/01-first-sound/first-sound.scene.json)

## Run It

```bash
pnpm exec tussel check examples/code/01-first-sound/first-sound.script.ts
pnpm exec tussel run examples/code/01-first-sound/first-sound.script.ts --watch
pnpm exec tussel render examples/code/01-first-sound/first-sound.scene.ts --out ./first-sound.wav --seconds 8
```

## What To Notice

- `setcps(0.75)` sets the transport in script mode.
- The final bare `scene(...)` expression becomes the live root.
- Each channel stays structural: `node`, `gain`, `mute`, and `orbit` are plain data, so the scene can also exist as `scene-ts` and `scene-json`.
