# Tussel Reference Parity Backbone

## Summary
Build Tussel around a hard reference-backed parity suite and make external source import part of that backbone from the start.

The project will add two coupled capabilities:

1. `Tidal` and `Strudel` source can be given directly to Tussel and imported into canonical Tussel `scene-ts`.
2. A local-only parity suite runs the reference engines and Tussel on the same cases, then hard-fails on any mismatch.

The suite is the backbone of the project. It is not optional coverage and it is not a loose “smoke test” layer.

Operational rules for the entire system:

- We do not assume Tidal or Strudel is wrong.
- We assume Tussel or a Tussel importer is wrong until proven otherwise.
- We do not comment out parity tests.
- We do not mark parity fixtures as expected failures.
- A committed fixture must pass.
- The final implementation step is always: run the full parity suite, fix Tussel/importer failures, rerun until green.

## Core Principles
- External source support is not a side feature. It is part of the parity architecture.
- Canonical internal form is always Tussel `scene-ts`.
- Tidal is the semantic oracle.
- Strudel is the exact offline audio oracle where deterministic render is available.
- Tussel must match both.
- The suite is local-only by default.
- The suite grows in levels, but any fixture already admitted into the suite is a hard requirement.

## High-Level Architecture
There are three flows, all using the same canonical `scene-ts` center:

1. User flow
   - user gives Tussel a native file or an external `Tidal`/`Strudel` file
   - Tussel imports or loads it
   - Tussel generates canonical `scene-ts`
   - normal `check`, `run`, `render`, and `convert` continue from there

2. Import flow
   - `Tidal` source -> Tussel importer -> canonical `scene-ts`
   - `Strudel` source -> Tussel importer -> canonical `scene-ts`

3. Parity flow
   - run Tidal oracle for event semantics
   - run Strudel oracle for exact offline audio where applicable
   - run Tussel on imported canonical `scene-ts`
   - compare events and audio
   - fail hard on any mismatch

## Important Changes To Public APIs / Interfaces / Types

### Source Kinds
Extend runtime source handling to include external inputs.

```ts
export type NativeSourceKind = 'script-ts' | 'scene-ts' | 'scene-json';
export type ExternalSourceKind = 'tidal' | 'strudel-js' | 'strudel-mjs' | 'strudel-ts';
export type SourceKind = NativeSourceKind | ExternalSourceKind;
```

### CLI
Extend existing commands to accept external files directly.

- `tussel run <entry>`
- `tussel check <entry>`
- `tussel render <entry> --out <file.wav>`
- `tussel convert <entry> --to scene-ts|script-ts|scene-json`
- `tussel import <entry> [--to scene-ts|script-ts|scene-json]`
  - explicit import-oriented alias
  - default target is `scene-ts`

Add shared external-source option:

- `--entry <binding-or-root>`
  - required only when an external whole-script file is ambiguous
  - supported by `run`, `check`, `render`, `convert`, and `import`

### Runtime Import Result
Add a stable import result used by runtime and parity code.

```ts
export interface ImportedScene {
  dependencies: string[];
  generatedPath: string;
  canonicalSceneTsPath: string;
  kind: SourceKind;
  scene: SceneSpec;
  importSource?: 'tidal' | 'strudel';
}
```

### Parity Fixture Type
Fixtures are typed TS modules.

```ts
export interface ParityFixture {
  id: string;
  title: string;
  level: 1 | 2 | 3 | 4 | 5;
  durationCycles: number;
  cps: number;
  samplePack?: string;
  seed?: number;
  compare: {
    events: 'exact';
    audio?: 'exact-pcm16';
  };
  sources: {
    tidal?: ExternalFixtureSource;
    strudel?: ExternalFixtureSource;
  };
  importTargets: Array<'tidal' | 'strudel'>;
}
```

```ts
export interface ExternalFixtureSource {
  path?: string;
  code?: string;
  entry?: string;
  shape: 'pattern' | 'script';
}
```

Rules:

- `level 1` and `level 2` require `tidal`
- `level 3` to `level 5` require both `tidal` and `strudel`
- if `importTargets` includes `tidal`, Tidal import must succeed
- if `importTargets` includes `strudel`, Strudel import must succeed
- if both importers run for a fixture, both resulting canonical scenes must be structurally equal before any oracle comparison proceeds

### Normalized Event Type
All adapters normalize to this exact shape.

```ts
export interface NormalizedEvent {
  begin: number;
  end: number;
  duration: number;
  channel: string;
  payload: Record<string, string | number | boolean | null>;
}
```

### Audio Output Contract
All audio comparisons use canonical WAV:

- stereo
- 48_000 Hz
- PCM 16-bit little-endian
- RIFF/WAVE canonical header
- compare PCM payload bytes exactly

## Source Import Design

### Supported External Inputs
Support all of these from the first implementation:

- `*.tidal`
- `*.strudel.js`
- `*.strudel.mjs`
- `*.strudel.ts`

Support both source shapes immediately:

- pattern files
- whole-script files

### Whole-Script Root Selection
Whole-script import must be decision-complete and not rely on guesswork.

Root selection rules:

1. If CLI `--entry <binding-or-root>` is provided, use it.
2. Else if the file has exactly one unambiguous live root, use it.
3. Else import fails hard with a diagnostic telling the user to provide `--entry`.

No file-pragma syntax is introduced in this version.

### Tidal Importer
Use two import paths.

#### Tidal Path A: `parseTidal`
Use `.ref/tidal/tidal-parse-ffi` for any case that can be expressed as parseable Tidal source text.

This is the default for:

- mini patterns
- control merges
- direct pattern expressions
- many common transforms supported by `parseTidal`

#### Tidal Path B: case registry
For whole-script or non-parseable-but-important Tidal cases, add a tiny Haskell runner registry inside the repo, backed by the `.ref/tidal` checkout.

This is not a general “evaluate arbitrary Haskell from user text” feature. It is a controlled adapter layer for parity and importer coverage.

Decision:
- user-facing `tussel import/run/check/render` on `.tidal` files still goes through the importer
- internally, ambiguous or unsupported Tidal constructs fail hard with a precise diagnostic
- no manual fallback scene is allowed for parity fixtures

### Strudel Importer
Support both:

- pattern-style Strudel sources
- whole Strudel script files

Importer behavior:

- parse script structure
- collect top-level state like `samples(...)`, `setcps(...)`, `setbpm(...)`
- resolve the chosen root pattern/scene
- lower the result into Tussel structural `SceneSpec`
- emit canonical `scene-ts`

### Canonical Output
All imports normalize into explicit Tussel `scene-ts` first.

Reasons:
- most explicit and inspectable representation
- best intermediate for parity debugging
- easiest stable form for future rewrites into `script-ts` or `scene-json`

For external inputs:

- `tussel import foo.tidal` defaults to `scene-ts`
- `tussel run foo.tidal` imports to cached canonical `scene-ts` internally, then runs
- `tussel convert foo.tidal --to script-ts` is external -> canonical `scene-ts` -> target render

### Cache Paths
Use deterministic cache paths:

- `.tussel-cache/imported/<stem>.imported.scene.ts`
- `.tussel-cache/generated/<stem>.generated.scene.ts`
- `.tussel-cache/parity/...`

## Parity Oracle Design

### Semantic Oracle
Tidal is the semantic oracle.

Use:

- `.ref/tidal/tidal-parse-ffi` for parseable cases
- a small Haskell case adapter for the rest

Event comparison is always exact.

### Audio Oracle
Strudel is the audio oracle.

Use:

- `.ref/strudel/packages/webaudio/webaudio.mjs`
- wrap it with a local Node-side adapter that returns canonical WAV bytes directly instead of browser download behavior

Audio comparison is exact PCM match on admitted fixtures.

### Why This Oracle Split Is Fixed
Tidal gives the strongest reference semantics.
Strudel already provides a deterministic offline audio render path.
Tidal does not expose one single canonical audio engine in the checkout the way Strudel exposes offline WebAudio render.

So the plan fixes the split:

- Tidal decides what the music means
- Strudel decides what exact admitted offline audio should be
- Tussel must satisfy both

## Parity Fixture Source-of-Truth Model
Fixtures are external-first.

Decision:
- a fixture may include Tidal source, Strudel source, or both
- semantic levels require Tidal source
- audio levels require both Tidal and Strudel source
- imported Tussel scenes are generated from the sources listed in `importTargets`
- if both Tidal and Strudel importers are listed for a fixture, both imports must succeed and produce identical canonical scenes

This makes import support part of the suite, not a separate nice-to-have.

## Level Structure

### Level 1: Parsing And Basic Event Semantics
Goal:
- basic parser and event parity

Requires:
- Tidal source
- Tidal import success into canonical `scene-ts`

Covers:
- literals
- rests
- cat
- square groups
- angle groups
- `*`
- `/`
- `!`
- `@`
- commas
- simple `s`, `n`, `gain`, `pan`

Pass:
- exact event parity vs Tidal
- imported Tussel scene valid and runnable

### Level 2: Transform And Control Semantics
Goal:
- exact parity for core timing/control behavior

Requires:
- Tidal source
- Tidal import success

Covers:
- `fast`
- `slow`
- `rev`
- `early`
- `late`
- `mask`
- `struct`
- value-pattern modulation
- control merges
- `begin`
- `end`
- `clip`
- `speed`
- `cut`
- `bank`
- selected higher-order constructs supported by reference adapters

Pass:
- exact event parity vs Tidal

### Level 3: Sample-Only Exact Audio
Goal:
- exact offline WAV parity on deterministic sample playback

Requires:
- Tidal source
- Strudel source
- Tidal import success
- Strudel import success
- imported scenes from both must be structurally equal

Covers:
- local committed sample pack only
- no network sample refs
- `s`
- `n`
- `bank`
- `begin`
- `end`
- `clip`
- `speed`
- `cut`
- one-channel and multi-channel sample cases

Pass:
- exact event parity vs Tidal
- exact PCM WAV parity vs Strudel

### Level 4: Deterministic Synth And FX Exact Audio
Goal:
- exact offline WAV parity for deterministic synthesis

Requires:
- Tidal source
- Strudel source
- both imports succeed and agree

Covers:
- `sine`
- `square`
- `triangle`
- `saw`
- ADSR
- pan
- `lpf`
- `hpf`
- deterministic modulation only
- no `noise`
- no random modulators yet

Pass:
- exact event parity vs Tidal
- exact PCM WAV parity vs Strudel

### Level 5: Mixed Full-Parity Pieces
Goal:
- real mixed scenes and high-confidence implementation quality

Requires:
- Tidal source
- Strudel source
- both imports succeed and agree

Covers:
- mixed samples + synths
- multiple channels
- longer phrases
- layered transforms
- one “all currently supported features mixed together” fixture
- coastline-style complexity for the supported subset

Pass:
- exact event parity vs Tidal
- exact PCM WAV parity vs Strudel

## Hard Rules For The Suite
- No commented-out parity tests.
- No xfails.
- No skip list for committed fixtures.
- No “temporary ignore until importer catches up.”
- Import failure is a failing parity result.
- Event mismatch is a failing parity result.
- Audio mismatch is a failing parity result.
- Red suite means Tussel or an importer must be fixed.

## Determinism Rules
- All parity assets are committed local WAV files in `reference/assets/`
- All audio runs are stereo, 48k, PCM16
- No network access during parity runs
- No random features in admitted fixtures until seed control is implemented identically across adapters
- `noise`, `rand`, and `perlin` are excluded from admitted exact-audio fixtures until deterministic cross-adapter seeds exist

## Repository Additions
Add these new areas:

- `packages/parity`
- `packages/parity/src/schema.ts`
- `packages/parity/src/load-fixtures.ts`
- `packages/parity/src/compare-events.ts`
- `packages/parity/src/compare-audio.ts`
- `packages/parity/src/report.ts`
- `packages/parity/src/adapters/tussel.ts`
- `packages/parity/src/adapters/tidal-ffi.ts`
- `packages/parity/src/adapters/tidal-cases.ts`
- `packages/parity/src/adapters/strudel.ts`
- `reference/fixtures/level-1`
- `reference/fixtures/level-2`
- `reference/fixtures/level-3`
- `reference/fixtures/level-4`
- `reference/fixtures/level-5`
- `reference/assets`
- `tools/reference/tidal-ffi`
- `tools/reference/tidal-cases`
- `tools/reference/strudel-render`
- `docs/parity-suite.md`

## Required Changes To Existing Tussel Internals

### Runtime
Extend source detection and prepare pipeline in [packages/runtime/src/index.ts](/mnt/storage/workspace/projects/tussel/packages/runtime/src/index.ts):

- detect external source kinds by extension
- add import stage before canonical scene preparation
- expose in-memory prepare/import helpers for parity runner

Add:

```ts
export async function importExternalSource(
  entryPath: string,
  options?: { entry?: string }
): Promise<ImportedScene>;
```

```ts
export async function prepareSceneFromSource(
  kind: SourceKind,
  code: string,
  options?: { entry?: string; filename?: string }
): Promise<ImportedScene>;
```

### Audio
Extend [packages/audio/src/index.ts](/mnt/storage/workspace/projects/tussel/packages/audio/src/index.ts):

- add in-memory WAV-buffer render helper
- keep deterministic sample rate/bit depth control explicit

Add:

```ts
export async function renderSceneToWavBuffer(
  scene: SceneSpec,
  options?: { seconds: number; sampleRate?: number }
): Promise<Buffer>;
```

### CLI
Extend [packages/cli/src/index.ts](/mnt/storage/workspace/projects/tussel/packages/cli/src/index.ts):

- allow external files in `run/check/render/convert`
- add `--entry`
- add `import` command

### Package Scripts
Add root scripts:

- `parity`
- `parity:doctor`
- `parity:build`
- `parity:run`
- `parity:level1`
- `parity:level2`
- `parity:level3`
- `parity:level4`
- `parity:level5`

## First-Wave Fixture Set
Initial fixture wave must include at least:

### Level 1
- simple `s "bd cp"`
- rest handling
- `!` replication
- `@` elongation
- basic control merge with `pan`

### Level 2
- `fast`
- `slow`
- `rev`
- `early`
- `late`
- `mask`
- `struct`
- `begin`
- `end`
- `clip`
- `speed`
- `cut`

### Level 3
- single-sample exact WAV
- banked sample exact WAV
- clipped sample exact WAV
- sped sample exact WAV
- cut-group exact WAV
- two-channel sample layer exact WAV

### Level 4
- sine exact WAV
- saw exact WAV
- square exact WAV
- triangle exact WAV
- ADSR exact WAV
- pan + filter exact WAV

### Level 5
- one longer mixed integration scene
- one coastline-style supported-subset scene
- one “all currently implemented supported features mixed” scene

## Failure Diagnostics
On failure, the suite must write artifact bundles in `.tussel-cache/parity/failures/<fixture-id>/`:

- `oracle.events.json`
- `tussel.events.json`
- `oracle.wav`
- `tussel.wav`
- `diff.json`
- `canonical.from-tidal.scene.ts` when applicable
- `canonical.from-strudel.scene.ts` when applicable

Console output must show:

- fixture id
- level
- import source(s)
- whether importer mismatch happened before oracle comparison
- first event mismatch
- first PCM mismatch and sample index
- summary by level

## Test Cases And Scenarios
Required scenarios:

- external Tidal pattern imports to valid canonical Tussel scene
- external Strudel script imports to valid canonical Tussel scene
- same fixture imported from both Tidal and Strudel yields the same canonical scene
- Tussel event stream exactly matches Tidal event stream
- Tussel audio exactly matches Strudel audio on admitted fixtures
- ambiguous external whole-script import fails with a clear `--entry` diagnostic
- unsupported external construct fails with a precise importer diagnostic
- every admitted fixture remains runnable through `tussel run`, `tussel check`, `tussel render`, and `tussel convert`

## Acceptance Criteria
The work is complete when all of these are true:

- `tussel run/check/render/convert` accept native and external source files
- `tussel import` exists and defaults to canonical `scene-ts`
- `.tidal` and `.strudel.{js,mjs,ts}` imports work for both pattern and whole-script cases
- parity harness runs locally with `pnpm parity run`
- level 1 and 2 event fixtures pass exactly against Tidal
- level 3 to 5 audio fixtures pass exactly against Strudel
- fixtures that import from both external sources produce identical canonical `scene-ts`
- no committed fixture is skipped, xfailed, or commented out
- final local parity run is green

## Assumptions And Defaults
- Chosen external input mode: import + run
- Chosen external source support: both pattern files and whole scripts immediately
- Chosen canonical output: `scene-ts`
- Chosen fixture source-of-truth model: external-first dual input
- Chosen import failure policy: hard fail, then implement importer support
- Chosen automation mode: local only
- Chosen semantic oracle: Tidal
- Chosen exact audio oracle: Strudel
- Chosen audio strictness: exact PCM match on admitted fixtures
- Chosen suite policy: no skipped committed fixtures, no commented-out parity tests
- Chosen debugging stance: treat all mismatches as Tussel/importer bugs first

## Task List
1. Extend runtime source detection to recognize `.tidal` and `.strudel.{js,mjs,ts}`.
2. Add canonical external import pipeline that always produces cached Tussel `scene-ts`.
3. Add shared `--entry` handling to `run`, `check`, `render`, `convert`, and new `import`.
4. Implement Tidal importer path based on `tidal-parse-ffi` for parseable external source.
5. Implement controlled Tidal case-runner path for external whole-script and non-parseable important cases.
6. Implement Strudel importer for both pattern and whole-script source.
7. Add in-memory Tussel event and WAV adapter helpers for the parity runner.
8. Add Strudel offline render adapter that returns canonical WAV bytes.
9. Add Tidal semantic adapter that returns canonical normalized events.
10. Create `packages/parity` with fixture loader, adapters, normalization, comparison, and failure artifact reporting.
11. Create the 5-level fixture tree and local deterministic parity sample assets.
12. Add first-wave fixtures for level 1 and 2 and make them pass.
13. Add first-wave exact-audio fixtures for level 3 and make them pass.
14. Add deterministic synth and mixed fixtures for level 4 and 5 and make them pass.
15. Add `docs/parity-suite.md` and document external import behavior plus parity workflow.
16. Run the full parity suite, treat every failure as a Tussel/importer defect, fix Tussel until the suite is green, rerun, and repeat until there are no failing fixtures.
