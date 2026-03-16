import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';

async function loadDslModule() {
  const workspaceDslUrl = new URL('../../dsl/src/index.ts', import.meta.url);
  if (existsSync(fileURLToPath(workspaceDslUrl))) {
    return import(workspaceDslUrl.href);
  }
  return import('@tussel/dsl');
}

async function main() {
  const moduleUrl = `${pathToFileURL(workerData.modulePath).href}?t=${Date.now()}`;
  const tusselDsl = await loadDslModule();
  const previousGlobals = new Map<string, { existed: boolean; value: unknown }>();

  for (const [key, value] of Object.entries(tusselDsl)) {
    previousGlobals.set(key, {
      existed: Object.hasOwn(globalThis, key),
      value: (globalThis as Record<string, unknown>)[key],
    });
    (globalThis as Record<string, unknown>)[key] = value;
  }

  tusselDsl.installStringPrototypeExtensions();

  try {
    const loaded = await import(moduleUrl);
    const { assertSceneSpec } = await loadDslModule();
    assertSceneSpec(loaded.default);
    parentPort?.postMessage({ ok: true, scene: loaded.default });
  } finally {
    tusselDsl.uninstallStringPrototypeExtensions();
    for (const [key, snapshot] of previousGlobals) {
      if (snapshot.existed) {
        (globalThis as Record<string, unknown>)[key] = snapshot.value;
      } else {
        delete (globalThis as Record<string, unknown>)[key];
      }
    }
  }
}

void main().catch((error: Error) => {
  parentPort?.postMessage({
    message: error.message,
    ok: false,
    stack: error.stack,
  });
});
