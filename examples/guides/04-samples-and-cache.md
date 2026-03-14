# 04 Samples And Cache

This example introduces local sample playback. It uses the tiny kit stored in this repository, so it runs without fetching anything from the network.

## Files

- [script-ts](../code/04-samples-and-cache/samples-and-cache.script.ts)
- [scene-ts](../code/04-samples-and-cache/samples-and-cache.scene.ts)
- [scene-json](../code/04-samples-and-cache/samples-and-cache.scene.json)
- [local manifest](../assets/basic-kit/strudel.json)

## Run It

```bash
pnpm exec tussel check examples/code/04-samples-and-cache/samples-and-cache.script.ts
pnpm exec tussel run examples/code/04-samples-and-cache/samples-and-cache.script.ts --watch
pnpm exec tussel render examples/code/04-samples-and-cache/samples-and-cache.scene.ts --out ./samples-and-cache.wav --seconds 8
```

## What To Notice

- `samples("./examples/assets/basic-kit")` registers the local pack from the repo root.
- The manifest includes both plain keys like `bd` and bank-prefixed keys like `crate_bd`, so `.bank("crate")` works with the same files.
- Remote refs such as `github:user/repo` are also part of the runtime, but the learning ladder uses a local pack so the example is deterministic.
