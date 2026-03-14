# Scene TS Reference

`*.scene.ts` is the explicit typed module format. It is the clearest source form when you want a durable scene definition instead of a looser script.

## Contract

- The file should `export default defineScene(...)`.
- Use imports from `@tussel/dsl` for pattern and signal builders.
- The exported object must resolve to a structural `SceneSpec`.

Reference examples:

- [first-sound.scene.ts](../examples/code/01-first-sound/first-sound.scene.ts)
- [channels-and-scene-objects.scene.ts](../examples/code/03-channels-and-scene-objects/channels-and-scene-objects.scene.ts)
- [full-piece-coastline.scene.ts](../examples/code/07-full-piece-coastline/full-piece-coastline.scene.ts)

## Minimal Shape

```ts
import { defineScene, n } from '@tussel/dsl';

export default defineScene({
  samples: [],
  transport: { cps: 0.75 },
  master: {},
  channels: {
    main: {
      node: n('0 2 4 7'),
    },
  },
});
```

## Top-Level Fields

- `channels`
  Required. A map of channel names to channel specs.
- `transport`
  Required. Usually `{ cps: ... }` or `{ bpm: ... }`.
- `samples`
  Required. Array of `{ ref: string }` sample sources.
- `metadata`
  Optional. Arbitrary structural metadata.
- `master`
  Optional. Structural master settings.

## Channel Fields

- `node`
  Required. Pattern expression for the channel.
- `gain`
  Optional. Number or structural expression.
- `mute`
  Optional. Boolean.
- `orbit`
  Optional. String tag carried with the channel.

## Notes On `master`

`master` is part of the structural scene model and conversion path. At the moment it is mainly carried as data; the audio backend does not yet expose a deep master-effects pipeline.

## Current Limitations

- `defineScene` rejects non-structural values such as functions, promises, classes, or custom instances.
- This format is exact and stable for the current runtime, but it does not imply full Strudel/Tidal semantic parity for every builder method.
