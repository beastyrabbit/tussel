import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { doctorParity } from './index.js';

describe.sequential('parity doctor', () => {
  const originalCwd = process.cwd();
  const originalPath = process.env.PATH ?? '';
  const tempDirs: string[] = [];

  afterEach(async () => {
    process.chdir(originalCwd);
    process.env.PATH = originalPath;
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it('fails with parity:setup guidance when Strudel install markers are missing', async () => {
    const fixtureRoot = await createParityFixture({
      installMarkers: ['.ref/strudel/node_modules'],
      pinnedCommits: {
        strudel: '1111111111111111111111111111111111111111',
      },
      resolvedCommits: {
        strudel: '1111111111111111111111111111111111111111',
      },
      tempDirs,
    });

    process.chdir(fixtureRoot);

    await expect(doctorParity()).rejects.toThrow(
      'Missing parity prerequisite: .ref/strudel/node_modules/.modules.yaml. Run `pnpm parity:setup` to install the pinned .ref/strudel dependencies.',
    );
  });

  it('fails when a pinned reference checkout drifts', async () => {
    const fixtureRoot = await createParityFixture({
      installMarkers: [
        '.ref/strudel/node_modules',
        '.ref/strudel/node_modules/.modules.yaml',
        '.ref/strudel/node_modules/.pnpm',
        '.ref/strudel/node_modules/@strudel',
      ],
      pinnedCommits: {
        strudel: '1111111111111111111111111111111111111111',
        tidal: '2222222222222222222222222222222222222222',
      },
      resolvedCommits: {
        strudel: '1111111111111111111111111111111111111111',
        tidal: '3333333333333333333333333333333333333333',
      },
      tempDirs,
    });

    process.chdir(fixtureRoot);

    await expect(doctorParity()).rejects.toThrow(
      '.ref/tidal is at 333333333333 but pinned to 222222222222. Run `git -C .ref/tidal checkout 2222222222222222222222222222222222222222` to restore the pinned reference.',
    );
  });
});

async function createParityFixture(options: {
  installMarkers: string[];
  pinnedCommits: Record<string, string>;
  resolvedCommits: Record<string, string>;
  tempDirs: string[];
}): Promise<string> {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'tussel-parity-'));
  options.tempDirs.push(fixtureRoot);

  await Promise.all([
    writeRelativeFile(fixtureRoot, '.ref/strudel/package.json', '{}\n'),
    writeRelativeFile(fixtureRoot, '.ref/strudel/pnpm-lock.yaml', 'lockfileVersion: 9.0\n'),
    writeRelativeFile(fixtureRoot, '.ref/strudel/packages/transpiler/index.mjs', 'export {};\n'),
    writeRelativeFile(fixtureRoot, '.ref/strudel/packages/supradough/dough.mjs', 'export {};\n'),
    mkdir(path.join(fixtureRoot, '.ref/tidal'), { recursive: true }),
    writeRelativeFile(
      fixtureRoot,
      '.ref/PINNED_COMMITS',
      Object.entries(options.pinnedCommits)
        .map(([name, commit]) => `${name}=${commit}`)
        .join('\n'),
    ),
  ]);

  for (const markerPath of options.installMarkers) {
    await ensurePath(fixtureRoot, markerPath);
  }

  await installFakeGit(fixtureRoot, options.resolvedCommits);
  return fixtureRoot;
}

async function installFakeGit(fixtureRoot: string, commits: Record<string, string>): Promise<void> {
  const binDir = path.join(fixtureRoot, 'bin');
  const gitPath = path.join(binDir, 'git');
  await mkdir(binDir, { recursive: true });
  await writeFile(
    gitPath,
    `#!/bin/sh
if [ "$1" != "rev-parse" ] || [ "$2" != "HEAD" ]; then
  echo "unexpected git invocation: $*" >&2
  exit 1
fi
case "$PWD" in
  */.ref/strudel)
    echo "${commits.strudel ?? ''}"
    ;;
  */.ref/tidal)
    echo "${commits.tidal ?? ''}"
    ;;
  *)
    echo "unexpected cwd: $PWD" >&2
    exit 1
    ;;
esac
`,
  );
  await chmod(gitPath, 0o755);
  process.env.PATH = `${binDir}${path.delimiter}${originalPathWithFallback()}`;
}

function originalPathWithFallback(): string {
  return process.env.PATH && process.env.PATH.length > 0 ? process.env.PATH : '/usr/bin:/bin';
}

async function writeRelativeFile(rootDir: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function ensurePath(rootDir: string, relativePath: string): Promise<void> {
  const targetPath = path.join(rootDir, relativePath);
  if (path.extname(relativePath)) {
    await writeRelativeFile(rootDir, relativePath, '\n');
    return;
  }
  await mkdir(targetPath, { recursive: true });
}
