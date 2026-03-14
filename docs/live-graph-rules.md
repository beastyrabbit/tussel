# Live Graph Rules

Tussel’s runtime model is structural. Every supported source format eventually becomes plain structural data plus expression nodes.

## Allowed

- numbers, strings, booleans, `null`
- arrays and plain objects
- named DSL calls such as `n('0 2 4 7')` or `s('bd hh sd hh')`
- method chains on builders such as `.fast(2).pan(sine.range(-1, 1).slow(4))`
- references to previously bound structural values
- top-level `samples(...)`, `setcps(...)`, and `setbpm(...)` in `script-ts`

## Not Allowed

- inline arrow functions or function declarations inside the live graph
- closures captured as musical behavior
- class instances, `Map`, `Set`, `Date`, or other non-plain objects
- promises or async values as scene content

## Why The Restriction Exists

- it keeps `script-ts`, `scene-ts`, and `scene-json` mutually convertible
- it makes typechecking and validation simpler
- it lets the runtime swap scenes in place without interpreting arbitrary user code as the musical graph itself

## Good Pattern

```ts
const pulse = n('0 2 4 7').s('sine').attack(0.02).release(0.2);

scene({
  channels: {
    pulse: { node: pulse, gain: 0.1 },
  },
  master: {},
});
```

## Bad Pattern

```ts
scene({
  channels: {
    pulse: {
      node: n('0 2 4 7').rarely(() => fast(2)),
    },
  },
  master: {},
});
```

The second example is not part of the supported structural subset because it embeds a callback.

## Current Semantic Caveat

Some advanced builder names from the Strudel/Tidal vocabulary already exist so they can survive typing and conversion, but not all of them are fully implemented musically yet. For reliable behavior, use the subset exercised in [`examples/code`](../examples/code/).
