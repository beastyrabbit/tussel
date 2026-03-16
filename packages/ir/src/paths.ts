import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Resolve a subdirectory under the project `.tussel-cache` folder.
 *
 * Resolution order:
 *  1. Explicit `baseDir` parameter (caller override).
 *  2. `TUSSEL_PROJECT_ROOT` environment variable.
 *  3. Walk up from `process.cwd()` until a directory containing `package.json` is found.
 *  4. Fall back to `process.cwd()`.
 *
 * Always returns `path.join(resolvedBase, '.tussel-cache', subdir)`.
 */
export function resolveTusselCacheDir(subdir: string, baseDir?: string): string {
  const root = baseDir ?? resolveProjectRoot();
  return path.join(root, '.tussel-cache', subdir);
}

export function resolveProjectRoot(baseDir = process.cwd()): string {
  const envRoot = process.env.TUSSEL_PROJECT_ROOT;
  if (envRoot) {
    return path.resolve(envRoot);
  }

  return findNearestPackageJsonDir(baseDir) ?? path.resolve(baseDir);
}

export function findNearestPackageJsonDir(startDir: string): string | undefined {
  let current = path.resolve(startDir);

  // eslint-disable-next-line no-constant-condition -- walk up until root
  while (true) {
    if (existsSync(path.join(current, 'package.json'))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      // Reached filesystem root without finding package.json
      return undefined;
    }
    current = parent;
  }
}
