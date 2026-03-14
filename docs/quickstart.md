# Quickstart

This is the shortest path from a file on disk to a running local Tussel daemon.

## Use An Existing Example

- [script-ts example](../examples/code/01-first-sound/first-sound.script.ts)
- [scene-ts example](../examples/code/01-first-sound/first-sound.scene.ts)
- [scene-json example](../examples/code/01-first-sound/first-sound.scene.json)
- [example guide](../examples/guides/01-first-sound.md)

## Commands

From the repository root:

```bash
pnpm install
pnpm exec tussel check examples/code/01-first-sound/first-sound.script.ts
pnpm exec tussel run examples/code/01-first-sound/first-sound.script.ts --watch
```

While `run` is active:

- save a valid change and Tussel reloads the scene in place
- save an invalid change and Tussel prints diagnostics while the last good scene keeps running
- stop with `Ctrl-C`

If you want a file instead of realtime output:

```bash
pnpm exec tussel render examples/code/01-first-sound/first-sound.scene.ts --out ./first-sound.wav --seconds 8
```

## Smallest Useful `script-ts`

```ts
setcps(0.75);

scene({
  channels: {
    main: {
      node: n('0 2 4 7').s('sine').attack(0.02).release(0.2),
      gain: 0.1,
    },
  },
  master: {},
});
```

Save that as `my-first.script.ts`, then run:

```bash
pnpm exec tussel run ./my-first.script.ts --watch
```

## What Happens Internally

- `*.script.ts` is transformed into generated `scene-ts`
- `*.scene.json` is also transformed into generated `scene-ts`
- the generated TS module is typechecked and executed
- the resulting structural `SceneSpec` is sent to the scheduler and audio engine

## Current Limitations

- `run` is the local daemon surface today; there is no GUI in this repo.
- `render` is the reliable fallback for headless use and CI.
- Hot reload keeps transport moving, but Tussel is still earlier than full Strudel/Tidal parity for advanced musical semantics.
