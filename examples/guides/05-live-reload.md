# 05 Live Reload

This example is designed to stay running while you edit it. The runtime keeps transport moving and swaps the scene in place on the next scheduling window.

## Files

- [script-ts](../code/05-live-reload/live-reload.script.ts)
- [scene-ts](../code/05-live-reload/live-reload.scene.ts)
- [scene-json](../code/05-live-reload/live-reload.scene.json)

## Run It

```bash
pnpm exec tussel run examples/code/05-live-reload/live-reload.script.ts --watch
```

## Edit Ideas

- Change the `pulse` note pattern from `0 2 4 7` to `0 3 5 7`.
- Raise the `air` filter from `5000` to `7000`.
- Change the shared `late(0.01)` offset to `late(0.02)`.

## What To Notice

- The runtime does not hard-stop the clock on save.
- Already-scheduled events are allowed to finish.
- The next lookahead window uses the updated scene at the current transport position.
