# Scene JSON Reference

`*.scene.json` is the tool-oriented structural format. It is the least pleasant format to hand-author, but it is the most direct representation of the runtime scene graph.

## Contract

- The file must satisfy the runtime JSON schema.
- It is validated before execution.
- It is converted into generated `scene-ts` before running.

Reference examples:

- [first-sound.scene.json](../examples/code/01-first-sound/first-sound.scene.json)
- [converting-between-formats.scene.json](../examples/code/06-converting-between-formats/converting-between-formats.scene.json)
- [full-piece-coastline.scene.json](../examples/code/07-full-piece-coastline/full-piece-coastline.scene.json)

## Required Top-Level Keys

- `channels`
- `samples`
- `transport`

Optional keys:

- `metadata`
- `master`

## Preferred Channel Shape

```json
{
  "channels": {
    "main": {
      "node": {
        "kind": "call",
        "name": "n",
        "exprType": "pattern",
        "args": ["0 2 4 7"]
      },
      "gain": 0.1,
      "mute": false,
      "orbit": "main"
    }
  },
  "samples": [],
  "transport": { "cps": 0.75 }
}
```

## Expression Node Forms

A call expression:

```json
{
  "kind": "call",
  "name": "n",
  "exprType": "pattern",
  "args": ["0 2 4 7"]
}
```

A method expression:

```json
{
  "kind": "method",
  "name": "fast",
  "exprType": "pattern",
  "target": {
    "kind": "call",
    "name": "n",
    "exprType": "pattern",
    "args": ["0 2 4 7"]
  },
  "args": [2]
}
```

## Practical Guidance

- Prefer generating JSON with `tussel convert ... --to scene-json`.
- Use `scene-ts` when humans need to maintain the file directly.
- Keep JSON scenes inside the structural subset if you want clean round trips back to `scene-ts` or `script-ts`.

## Current Limitations

- The schema is broad enough to accept structural values beyond the preferred channel-object form, but the recommended stable shape is full channel specs with `node`.
- JSON captures structure, not author intent. Local variable names, comments, and higher-level formatting are not preserved.
