# Tussel Examples

This tree is the learning ladder for the current local-first Tussel runtime. Every topic includes the same scene in three forms:

- `script-ts`: Strudel-like livecoding syntax in `*.script.ts`
- `scene-ts`: explicit typed scene modules in `*.scene.ts`
- `scene-json`: structural scene graphs in `*.scene.json`

Run commands from the repository root so local sample refs like `./examples/assets/basic-kit` resolve correctly.

## Quickstart

```bash
pnpm exec tussel check examples/code/01-first-sound/first-sound.script.ts
pnpm exec tussel run examples/code/01-first-sound/first-sound.script.ts --watch
pnpm exec tussel render examples/code/01-first-sound/first-sound.scene.ts --out ./first-sound.wav --seconds 8
```

## Reference Docs

- [Docs Index](../docs/README.md)
- [Quickstart](../docs/quickstart.md)
- [Script Syntax Guide](../docs/script-syntax.md)
- [Scene TS Reference](../docs/scene-ts-reference.md)
- [Scene JSON Reference](../docs/scene-json-reference.md)
- [Conversion Guide](../docs/conversion-guide.md)
- [Live Graph Rules](../docs/live-graph-rules.md)
- [Worked Coastline-Style Example](../docs/worked-example-coastline.md)

## Learning Ladder

1. [01 First Sound](guides/01-first-sound.md)
   [script-ts](code/01-first-sound/first-sound.script.ts),
   [scene-ts](code/01-first-sound/first-sound.scene.ts),
   [scene-json](code/01-first-sound/first-sound.scene.json)
2. [02 Patterns and Mini](guides/02-patterns-and-mini.md)
   [script-ts](code/02-patterns-and-mini/patterns-and-mini.script.ts),
   [scene-ts](code/02-patterns-and-mini/patterns-and-mini.scene.ts),
   [scene-json](code/02-patterns-and-mini/patterns-and-mini.scene.json)
3. [03 Channels and Scene Objects](guides/03-channels-and-scene-objects.md)
   [script-ts](code/03-channels-and-scene-objects/channels-and-scene-objects.script.ts),
   [scene-ts](code/03-channels-and-scene-objects/channels-and-scene-objects.scene.ts),
   [scene-json](code/03-channels-and-scene-objects/channels-and-scene-objects.scene.json)
4. [04 Samples and Cache](guides/04-samples-and-cache.md)
   [script-ts](code/04-samples-and-cache/samples-and-cache.script.ts),
   [scene-ts](code/04-samples-and-cache/samples-and-cache.scene.ts),
   [scene-json](code/04-samples-and-cache/samples-and-cache.scene.json)
5. [05 Live Reload](guides/05-live-reload.md)
   [script-ts](code/05-live-reload/live-reload.script.ts),
   [scene-ts](code/05-live-reload/live-reload.scene.ts),
   [scene-json](code/05-live-reload/live-reload.scene.json)
6. [06 Converting Between Formats](guides/06-converting-between-formats.md)
   [script-ts](code/06-converting-between-formats/converting-between-formats.script.ts),
   [scene-ts](code/06-converting-between-formats/converting-between-formats.scene.ts),
   [scene-json](code/06-converting-between-formats/converting-between-formats.scene.json)
7. [07 Full Piece Coastline](guides/07-full-piece-coastline.md)
   [script-ts](code/07-full-piece-coastline/full-piece-coastline.script.ts),
   [scene-ts](code/07-full-piece-coastline/full-piece-coastline.scene.ts),
   [scene-json](code/07-full-piece-coastline/full-piece-coastline.scene.json)

## Local Sample Pack

- [Manifest](assets/basic-kit/strudel.json)
- [Kick](assets/basic-kit/bd.wav)
- [Hi-hat](assets/basic-kit/hh.wav)
- [Snare](assets/basic-kit/sd.wav)
- [Rim](assets/basic-kit/rim.wav)
