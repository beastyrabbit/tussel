# Tussel — Claude Code Project Guide

## What This Is

Local-first TypeScript livecoding runtime inspired by Tidal and Strudel. Terminal daemon for pattern-based music livecoding. pnpm monorepo, 9 packages.

## Package Map

| Package | Purpose |
|---------|---------|
| `core` | Pattern query engine, time modifiers, method dispatch (~3800-line index.ts) |
| `dsl` | PatternBuilder/SignalBuilder, transform factories, String.prototype extensions |
| `audio` | Web Audio rendering, samples, effects, MIDI/OSC output, WAV export |
| `ir` | Expression node types, SceneSpec, CSound/Hydra stubs, structured logger |
| `mini` | Mini notation parser (Tidal-style `"bd sd [hh hh]"`) |
| `runtime` | Scene compilation (esbuild+TS), daemon, worker threads, Tidal/Strudel adapters |
| `cli` | CLI entry point (`bin/tussel`) |
| `parity` | Audio comparison test infrastructure: tussel vs Strudel reference |
| `testkit` | Shared test utilities |

## Architecture Patterns

### Method Dispatch
1. `PROPERTY_METHODS` set in `core/src/index.ts` — simple property annotations bypass switch
2. Everything else goes through `queryPattern`'s main switch for transforms, time mods, etc.

### Adding a New Pattern Method
1. Add switch case in `packages/core/src/index.ts` `queryPattern()`
2. Add method to `PatternBuilder` in `packages/dsl/src/index.ts`
3. If property-only: add to `PROPERTY_METHODS` in core and `SIMPLE_PROPERTY_METHODS` in DSL
4. Add to `STRING_PATTERN_METHODS` in DSL for string prototype extension
5. Add parity fixture in `packages/parity/`

### DSL Builder Pattern
- `PatternBuilder` and `SignalBuilder` wrap `ExpressionNode` IR
- `normalizeValue()` converts builder/JS values → `ExpressionValue`
- `scene()` / `defineScene()` produce `SceneSpec` (the IR consumed by audio/runtime)

### String.prototype Patching
- `installStringPrototypeExtensions()` / `uninstallStringPrototypeExtensions()` in DSL
- Enables `"bd sd".fast(2)` syntax
- Ref-counted; conflicts with existing properties are silently skipped (logged as warning)

## Commands

```bash
pnpm check              # lint + build + test (full suite)
pnpm test               # vitest run (all tests, ~25+ min with audio parity)
pnpm lint               # biome check
pnpm build              # tsc --noEmit
pnpm clean:artifacts    # remove stale .js/.d.ts/.js.map from src/ dirs
pnpm parity:run         # full parity suite against Strudel reference
pnpm parity:doctor      # verify parity infrastructure
```

### Fast Feedback During Development
```bash
npx vitest run packages/core/ packages/dsl/ packages/mini/ packages/ir/
```
Runs in seconds. The full suite takes 25+ minutes due to audio rendering and Strudel parity comparison.

## Conventions

- **Structured logging** via `createLogger()` from `@tussel/ir` — never use raw `console.log` except in CLI tools and intentional debug methods
- **Error taxonomy** uses `TusselValidationError`, `TusselCoreError`, `TusselInputError`, `TusselHydraError` from `@tussel/ir`
- **Build output** goes to `dist/` (via `tsconfig.build.json`), never into `src/`
- **Gitleaks** is required on pre-commit (lefthook); hook fails if gitleaks is not installed
- **No build artifacts in src/** — lefthook pre-commit checks for stale `.js`/`.d.ts`/`.js.map`

## Known Limitations

- CSound integration is heuristic synthesis approximation, not real CSound execution
- Hydra is out of scope (terminal-only product; no WebGL)
- Tidal parser covers ~60 of 100+ methods (regex tokenizer, not AST)
- `createParam()`/`createParams()` exported from DSL but throws at runtime
- `punchcard()`, `_punchcard()`, `_scope()` are metadata-only stubs in terminal mode
