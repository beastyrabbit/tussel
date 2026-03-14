# Script Syntax Guide

`*.script.ts` is the closest current authoring mode to Strudel-style livecoding, while still staying valid TypeScript.

## Contract

- The file must end with a bare top-level expression.
- That final expression becomes the live root.
- Top-level `const` and `let` bindings are allowed.
- Normal `import` statements are allowed.
- Metadata comments such as `// "Title"` and `// @by name` are collected into `scene.metadata`.

The most predictable root is `scene({...})`, but a bare pattern expression such as `stack(...)` also works.

## Available Globals

- Patterns: `stack`, `s`, `sound`, `n`, `note`, `chord`, `fast`, `slow`, `ply`, `silence`, `value`
- Signals: `sine`, `triangle`, `tri`, `square`, `saw`, `rand`, `perlin`
- Helpers: `mini`, `m`, `scene`, `samples`, `setcps`, `setbpm`, `defineScene`

Example:

```ts
// "Live Reload"
// @guide 05-live-reload
setcps(0.7);

const pulse = n('0 2 4 7').s('sine').attack(0.02).release(0.2);

scene({
  channels: {
    pulse: {
      node: pulse.late(0.01),
      gain: 0.1,
      orbit: 'pulse',
    },
  },
  master: {},
});
```

Reference example:

- [live-reload.script.ts](../examples/code/05-live-reload/live-reload.script.ts)

## String Helpers

String literals are patched with structural timing/math helpers so values like these stay valid TS:

- `'<1 0 1 1>/4'.fast(2)`
- `'<0 1>'.early(0.25)`
- `'<1 0 1 0>'.slow(2)`

Those helpers produce structural pattern values, which is useful for masks and parameter modulation.

## Best Practices

- Prefer `scene({...})` when you want stable named channels and better conversion results.
- Keep reusable fragments in `const` bindings rather than duplicating long chains.
- Use `samples(...)` and `setcps(...)` at top level so they survive conversion cleanly.

## Current Limitations

- The last top-level statement must be an expression. A script that ends with declarations only will fail.
- The runtime only accepts structural values in the live graph. Functions and callbacks are not part of the supported authoring subset.
- Some advanced Strudel/Tidal-flavored methods already exist on the builders but are not yet fully implemented musically. The safest subset is the one used across [`examples/code`](../examples/code/).
