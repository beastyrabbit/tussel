# Parity Suite

The parity suite is the reference backbone for Tussel.

- Tidal parity is currently mediated through Strudel translation, not a native Tidal runtime.
- Strudel is the exact offline audio oracle for admitted fixtures.
- Tussel is assumed wrong until the suite says otherwise.
- Committed fixtures are hard-fail only: no skips, no xfails, no commented-out parity cases.

Related docs:

- [Quickstart](./quickstart.md)
- [Conversion Guide](./conversion-guide.md)
- [Fixture Tree](../reference/fixtures)

## Commands

```sh
pnpm parity:setup
pnpm parity:doctor
pnpm parity:build
pnpm parity:run
pnpm parity:level1
pnpm parity:level2
pnpm parity:level3
pnpm parity:level4
pnpm parity:level5
```

`pnpm parity:setup` installs the `.ref/strudel` submodule dependencies that the audio oracle requires. `pnpm parity:doctor` validates both the checkout and the pinned reference revisions, including the expected pnpm install metadata under `.ref/strudel/node_modules`.

CI runs the same contract in order: `pnpm parity:setup`, `pnpm parity:doctor`, then parity levels 1 through 5.

You can also call the runner directly:

```sh
pnpm parity list
pnpm parity run --fixture level-3/single-sample-audio --save-artifacts
pnpm parity run --level 4 --save-artifacts
```

## External Inputs

The public CLI accepts native Tussel sources and external references:

- native: `*.script.ts`, `*.scene.ts`, `*.scene.json`
- external: `*.tidal`, `*.strudel.js`, `*.strudel.mjs`, `*.strudel.ts`

External sources go through import first and are normalized into cached canonical `scene-ts`:

- `.tussel-cache/generated/*.generated.scene.ts`
- `.tussel-cache/imported/*.imported.scene.ts`

The same import path is used by:

- `tussel check <entry>`
- `tussel run <entry>`
- `tussel render <entry> --out <file.wav>`
- `tussel convert <entry> --to scene-ts|script-ts|scene-json`
- `tussel import <entry> [--to scene-ts|script-ts|scene-json]`

Use `--entry <binding-or-root>` when an external whole-script source is ambiguous. If the importer cannot select one live root unambiguously, it must fail and ask for `--entry`.

## Fixture Levels

- Level 1: parser and basic event parity against Strudel-mediated Tidal translation
- Level 2: timing/control parity against Strudel-mediated Tidal translation
- Level 3: sample-only exact WAV parity against Strudel plus exact events against Strudel-mediated Tidal translation
- Level 4: deterministic synth/filter exact WAV parity against Strudel plus exact events against Strudel-mediated Tidal translation
- Level 5: mixed full-scene parity with both external imports enabled

Fixtures live under `reference/fixtures/level-1` through `reference/fixtures/level-5`.

## Failure Artifacts

Failures are written under `.tussel-cache/parity/failures/<fixture-id>/`.

Possible artifacts:

- `oracle.events.json`
- `tussel.events.json`
- `oracle.wav`
- `tussel.wav`
- `diff.json`
- `canonical.from-tidal.scene.ts`
- `canonical.from-strudel.scene.ts`

The suite also writes a run summary to `.tussel-cache/parity/latest.json`.

## Workflow

1. Add or update the external source fixture.
2. Import it through Tussel and require canonical `scene-ts`.
3. Run the parity level or the full suite.
4. Treat any mismatch as a Tussel or importer defect.
5. Fix Tussel.
6. Rerun until green.

The suite is local-only by default, but it is not optional. A feature is not complete until it is represented by a committed parity fixture and the suite passes.
