# 06 Converting Between Formats

This scene stays inside the current round-trippable subset: structural scene objects, named DSL calls, and no free-form callbacks. That makes it a good conversion fixture.

## Files

- [script-ts](../code/06-converting-between-formats/converting-between-formats.script.ts)
- [scene-ts](../code/06-converting-between-formats/converting-between-formats.scene.ts)
- [scene-json](../code/06-converting-between-formats/converting-between-formats.scene.json)

## Convert It

```bash
pnpm exec tussel convert examples/code/06-converting-between-formats/converting-between-formats.script.ts --to scene-ts
pnpm exec tussel convert examples/code/06-converting-between-formats/converting-between-formats.scene.ts --to scene-json
pnpm exec tussel convert examples/code/06-converting-between-formats/converting-between-formats.scene.ts --to script-ts
```

## What To Notice

- `script-ts` is the friendliest livecoding surface.
- `scene-ts` is the clearest typed module format.
- `scene-json` is the pure structural format for tooling, persistence, and future integrations.
