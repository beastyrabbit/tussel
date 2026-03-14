# 02 Patterns And Mini

This example shows the current mini-notation subset and the tagged helpers `mini` and `m`.

## Files

- [script-ts](../code/02-patterns-and-mini/patterns-and-mini.script.ts)
- [scene-ts](../code/02-patterns-and-mini/patterns-and-mini.scene.ts)
- [scene-json](../code/02-patterns-and-mini/patterns-and-mini.scene.json)

## Run It

```bash
pnpm exec tussel check examples/code/02-patterns-and-mini/patterns-and-mini.script.ts
pnpm exec tussel run examples/code/02-patterns-and-mini/patterns-and-mini.script.ts --watch
```

## What To Notice

- `mini\`...\`` and `m\`...\`` produce the same string-shaped mini source the runtime already understands.
- The current evaluator supports literals, rests, groups, slowcat, repeats, and stretch syntax.
- `fast`, `slow`, `mask`, and signal-driven filters already execute in the current runtime, so this example is useful both as documentation and as a real smoke test.
