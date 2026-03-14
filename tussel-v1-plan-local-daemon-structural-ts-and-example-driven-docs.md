# Tussel V1 Plan: Local Daemon, Structural TS, and Example-Driven Docs

## Summary
- Tussel V1 is a local terminal daemon that watches a livecoding file, recompiles on save, and updates the running music without stopping transport.
- Authoring supports three user-facing formats:
  - `script-ts`: Strudel-like TypeScript scripts
  - `scene-ts`: explicit typed TypeScript scene modules
  - `scene-json`: full JSON scene files
- Every input format is transformed into a generated typed TypeScript module before execution.
- Every executable program must resolve to the same structural `SceneSpec` object graph so `script-ts`, `scene-ts`, and `scene-json` can convert between each other.
- The live graph is structural only: concise chain syntax is allowed, but no free-form callbacks inside musical expressions.
- Documentation lives under `examples/` and is part of the product surface, not an afterthought.

## Core Runtime Behavior
- Hot reload must match Strudel’s swap model:
  - the transport clock never stops on edit
  - the scheduler keeps already-scheduled events
  - future lookahead windows query the new scene immediately at the current cycle position
  - edits do not hard-cut the music by default
- This behavior should be implemented by replacing the active compiled scene pointer in place, not by stopping and restarting playback.
- Default scheduler timing should start close to Strudel’s current values:
  - window duration `0.05s`
  - tick interval `0.1s`
  - overlap/lookahead `0.1s`
  - trigger latency `0.1s`

## Source Formats
- `script-ts`
  - extension: `*.script.ts`
  - ambient globals such as `samples`, `setcps`, `stack`, `s`, `n`, `chord`
  - top-level `let` and `const` allowed
  - final top-level expression becomes the root scene
- `scene-ts`
  - extension: `*.scene.ts`
  - must `export default defineScene(...)`
- `scene-json`
  - extension: `*.scene.json`
  - validated against schema and converted into generated TS before execution

## Canonical Compilation Pipeline
- `script-ts -> generated scene-ts`
  - parse with TypeScript compiler API
  - rewrite final top-level expression to recorder capture
  - top-level state calls like `samples()` and `setcps()` mutate a `SceneRecorder`
  - emit generated typed module exporting `defineScene(recorder.finalize())`
- `scene-json -> generated scene-ts`
  - validate JSON
  - emit generated typed module exporting `defineScene(<typed object literal>)`
- `scene-ts`
  - use directly after typecheck
- Execution always runs the typed TS module.
- Semantic runtime always consumes the resulting `SceneSpec`.

## Public APIs / Types
```ts
interface SceneSpec {
  transport: TransportSpec;
  samples: SampleSourceSpec[];
  channels: Record<string, ChannelSpec>;
  master?: MasterSpec;
  metadata?: MetadataSpec;
}

interface TransportSpec {
  cps?: SignalNode;
  bpm?: SignalNode;
}

interface ChannelSpec {
  node: PatternNode;
  gain?: SignalNode;
  mute?: boolean;
  orbit?: string;
}
```

```ts
declare function defineScene(scene: SceneSpec): SceneSpec;
declare function samples(ref: SampleSource): void;
declare function setcps(value: number | SignalNode): void;
declare function stack(...nodes: SceneNode[]): SceneNode;
declare function s(mini: string | MiniNode): PatternNode;
declare function n(mini: string | MiniNode): PatternNode;
declare function chord(mini: string | MiniNode): PatternNode;
```

## Language Boundary
- The musical program is an object algebra hosted in TS.
- Allowed in the live graph:
  - named DSL calls
  - method chaining
  - literals, arrays, objects, references to bound variables
- Disallowed in the live graph:
  - inline arrow/function callbacks
  - arbitrary runtime closures
  - semantics that cannot lower to nested objects
- This keeps all formats losslessly convertible while preserving the short Strudel-like surface syntax.

## CLI
- `tussel run <entry.(script.ts|scene.ts|scene.json)> [--watch] [--backend realtime|offline]`
- `tussel check <entry.(script.ts|scene.ts|scene.json)>`
- `tussel render <entry.(script.ts|scene.ts|scene.json)> --out <file.wav>`
- `tussel convert <entry.(script.ts|scene.ts|scene.json)> --to script-ts|scene-ts|scene-json`

## Audio
- Primary realtime backend: `node-web-audio-api`
- Required fallback: offline render for CI and non-realtime environments
- V1 sound scope:
  - synths: `sine`, `saw`, `square`, `triangle`, `noise`
  - sample playback
  - core controls: gain, pan, ADSR, LPF/HPF, delay, room, size, speed, begin/end, orbit, cut
- Sample source support:
  - local folders/manifests
  - remote refs like `github:user/repo[/branch]`
- Remote samples are cached locally for offline reuse after first fetch.

## Repo Structure
- `packages/ir`
- `packages/core`
- `packages/mini`
- `packages/dsl`
- `packages/runtime`
- `packages/audio`
- `packages/cli`
- `packages/testkit`
- `examples/`

## Examples And Documentation
- `examples/README.md` is the learning index.
- Learning guides live in `examples/guides/`.
- Runnable example files live in `examples/code/`.
- Each guide must contain direct relative links to the exact example files it discusses.
- Required V1 layout:
  - `examples/README.md`
  - `examples/guides/01-first-sound.md`
  - `examples/guides/02-patterns-and-mini.md`
  - `examples/guides/03-channels-and-scene-objects.md`
  - `examples/guides/04-samples-and-cache.md`
  - `examples/guides/05-live-reload.md`
  - `examples/guides/06-converting-between-formats.md`
  - `examples/guides/07-full-piece-coastline.md`
  - `examples/code/01-first-sound/first-sound.script.ts`
  - `examples/code/01-first-sound/first-sound.scene.ts`
  - `examples/code/01-first-sound/first-sound.scene.json`
  - same pattern for each guide topic
- The examples set is a learning ladder, not just API coverage.
- Every guide must explain the concept, show the runnable files, and reference the matching TS/JSON/script variants.

## Conversion Rules
- `script-ts -> scene-ts` is exact
- `scene-json -> scene-ts` is exact
- `scene-ts -> scene-json` is exact for all valid live scenes
- `scene-ts -> script-ts` should emit readable script syntax where structurally possible and preserve semantics exactly
- Because the live graph is structural-only, all valid Tussel live programs remain round-trippable

## Testing
- Port Strudel conformance cases from `.ref/strudel` for:
  - pattern math
  - mini notation
  - selected combinator semantics
- Port selected Tidal semantic cases from `.ref/tidal` into TS fixtures
- Add format-conversion tests for semantic equivalence across all three formats
- Add daemon tests:
  - mid-cycle edits do not hard-cut audio
  - last good scene continues after errors
  - import graph watching works
- Add docs/examples tests:
  - every linked example path in markdown exists
  - every example typechecks
  - every example can be converted into the other two formats
  - selected examples render deterministically offline

## Documentation Deliverables
- Quickstart for `file -> daemon -> audio`
- Script syntax guide
- Scene TS reference
- Scene JSON reference
- Conversion guide
- Live graph rules guide with allowed/disallowed examples
- Full worked example based on the “coastline” style source

## Assumptions And Defaults
- V1 scope is daemon/CLI only, not GUI or VS Code plugin
- Authoring feel should stay close to Strudel while semantics remain Tidal-oriented
- Continuous transport swap behavior is mandatory
- Generated typed TS is the execution form for every input
- Structural `SceneSpec` is the semantic source of truth
- No free-form callbacks inside the live graph
- Examples and markdown guides under `examples/` are required deliverables, not optional docs work
