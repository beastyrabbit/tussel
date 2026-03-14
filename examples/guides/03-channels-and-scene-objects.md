# 03 Channels And Scene Objects

This step switches from a single root expression to a named channel map. It is the clearest view of the current structural scene model.

## Files

- [script-ts](../code/03-channels-and-scene-objects/channels-and-scene-objects.script.ts)
- [scene-ts](../code/03-channels-and-scene-objects/channels-and-scene-objects.scene.ts)
- [scene-json](../code/03-channels-and-scene-objects/channels-and-scene-objects.scene.json)

## Run It

```bash
pnpm exec tussel check examples/code/03-channels-and-scene-objects/channels-and-scene-objects.scene.ts
pnpm exec tussel run examples/code/03-channels-and-scene-objects/channels-and-scene-objects.scene.ts --watch
```

## What To Notice

- Transport can live inside the scene object as `transport: { cps: ... }`.
- Named channels make later tooling easier because the runtime can address `drums`, `bass`, and `lead` directly.
- The `scene-ts` file is the most explicit authoring format and maps one-to-one to the runtime’s `SceneSpec`.
