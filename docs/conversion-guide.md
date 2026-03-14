# Conversion Guide

Tussel can convert between `script-ts`, `scene-ts`, and `scene-json`. The conversion path is built around one shared structural scene graph.

## Reference Fixture

- [script-ts](../examples/code/06-converting-between-formats/converting-between-formats.script.ts)
- [scene-ts](../examples/code/06-converting-between-formats/converting-between-formats.scene.ts)
- [scene-json](../examples/code/06-converting-between-formats/converting-between-formats.scene.json)
- [example guide](../examples/guides/06-converting-between-formats.md)

## Commands

```bash
pnpm exec tussel convert examples/code/06-converting-between-formats/converting-between-formats.script.ts --to scene-ts
pnpm exec tussel convert examples/code/06-converting-between-formats/converting-between-formats.scene.ts --to scene-json
pnpm exec tussel convert examples/code/06-converting-between-formats/converting-between-formats.scene.ts --to script-ts
```

Add `--out <file>` to write the result to disk instead of stdout.

## What Is Preserved

- channel names and channel structure
- pattern and signal expressions
- `samples`, `transport`, `metadata`, and `master`
- stable JSON ordering when targeting `scene-json`

## What Changes

- formatting is regenerated
- `script-ts` comments are only preserved through metadata comments, not arbitrary prose comments
- local variable names from authored TS are not reconstructed

## Important Current Limitation

`scene-ts -> script-ts` works, but it currently emits a compact structural script centered on `scene({...})`. It does not yet recreate a more hand-written Strudel-like script with intermediate `const` bindings or stylistic formatting.

## Round-Trip Expectations

Round trips are most reliable when the scene stays inside the live-graph subset:

- structural values only
- named DSL calls and method chains
- no callbacks or opaque runtime objects

If you stay in that subset, the runtime model remains conversion-friendly even when the pretty-printing is still conservative.
