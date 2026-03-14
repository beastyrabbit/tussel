# Tussel Docs

These pages document the current repository state, not just the saved plan. Where the plan is ahead of the implementation, the docs call that out directly.

## Start Here

- [Quickstart](./quickstart.md)
- [Script Syntax Guide](./script-syntax.md)
- [Scene TS Reference](./scene-ts-reference.md)
- [Scene JSON Reference](./scene-json-reference.md)
- [Conversion Guide](./conversion-guide.md)
- [Live Graph Rules](./live-graph-rules.md)
- [Worked Coastline-Style Example](./worked-example-coastline.md)
- [Native Placeholder Task List](./native-placeholder-task-list.md)
- [Audit Remediation Checklist](./audit-remediation-checklist.md)

## Learning Ladder

The runnable tutorial set is still centered in [`examples/`](../examples/README.md):

- [Examples Index](../examples/README.md)
- [First Sound](../examples/guides/01-first-sound.md)
- [Patterns and Mini](../examples/guides/02-patterns-and-mini.md)
- [Channels and Scene Objects](../examples/guides/03-channels-and-scene-objects.md)
- [Samples and Cache](../examples/guides/04-samples-and-cache.md)
- [Live Reload](../examples/guides/05-live-reload.md)
- [Converting Between Formats](../examples/guides/06-converting-between-formats.md)
- [Full Piece Coastline](../examples/guides/07-full-piece-coastline.md)

## Current Scope

- Local terminal workflow only: `file -> tussel daemon -> audio`.
- Source formats: `*.script.ts`, `*.scene.ts`, `*.scene.json`.
- Conversion works across all three formats.
- The musical graph is structural and conversion-friendly by design.
- Editor tooling and visuals are not covered here.
