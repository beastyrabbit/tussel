import { pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';

async function main() {
  const moduleUrl = `${pathToFileURL(workerData.modulePath).href}?t=${Date.now()}`;
  const loaded = await import(moduleUrl);
  parentPort?.postMessage({ ok: true, scene: loaded.default });
}

void main().catch((error: Error) => {
  parentPort?.postMessage({
    message: error.message,
    ok: false,
    stack: error.stack,
  });
});
