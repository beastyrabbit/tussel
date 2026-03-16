import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFixtureDirectory, writeFixtureFile } from '@tussel/testkit';
import { afterEach, describe, expect, it } from 'vitest';

interface Runner {
  child: ChildProcessWithoutNullStreams;
  getOutput: () => string;
  stop: () => Promise<void>;
  waitFor: (pattern: string | RegExp, occurrences?: number, timeoutMs?: number) => Promise<void>;
}

const runners: Runner[] = [];

describe('daemon runtime', () => {
  afterEach(async () => {
    await Promise.all(runners.splice(0, runners.length).map((runner) => runner.stop()));
  });

  it('reloads when the watched entry file changes', async () => {
    const rootDir = await createFixtureDirectory('tussel-daemon-entry-');
    const entry = await writeFixtureFile(
      rootDir,
      'live.script.ts',
      `setcps(0.7);\nscene({ channels: { lead: { node: s('bd bd'), gain: 0.1 } }, master: {} });\n`,
    );

    const runner = startRunner(entry);
    runners.push(runner);

    await runner.waitFor(/Loaded script-ts/, 1);
    await writeFile(
      entry,
      `setcps(0.7);\nscene({ channels: { lead: { node: s('bd hh sd hh'), gain: 0.1 } }, master: {} });\n`,
    );
    await runner.waitFor(/Loaded script-ts/, 2);
  }, 60_000);

  it('keeps running after a bad save and recovers on the next good save', async () => {
    const rootDir = await createFixtureDirectory('tussel-daemon-recover-');
    const entry = await writeFixtureFile(
      rootDir,
      'live.script.ts',
      `setcps(0.7);\nscene({ channels: { lead: { node: s('bd bd'), gain: 0.1 } }, master: {} });\n`,
    );

    const runner = startRunner(entry);
    runners.push(runner);

    await runner.waitFor(/Loaded script-ts/, 1);
    await writeFile(
      entry,
      `setcps(0.7);\nscene({ channels: { lead: { node: s('bd hh), gain: 0.1 } }, master: {} });\n`,
    );
    await runner.waitFor(/TS1002|Unterminated string literal/, 1, 25_000);
    expect(runner.child.exitCode).toBeNull();

    await writeFile(
      entry,
      `setcps(0.7);\nscene({ channels: { lead: { node: s('bd hh sd hh'), gain: 0.1 } }, master: {} });\n`,
    );
    await runner.waitFor(/Loaded script-ts/, 2, 25_000);
  }, 60_000);

  it('reloads when an imported module changes', async () => {
    const rootDir = await createFixtureDirectory('tussel-daemon-import-');
    await writeFixtureFile(rootDir, 'shared.ts', `export const DRUMS = 'bd bd';\n`);
    const entry = await writeFixtureFile(
      rootDir,
      'live.script.ts',
      `import { DRUMS } from './shared.ts';\nsetcps(0.7);\nscene({ channels: { lead: { node: s(DRUMS), gain: 0.1 } }, master: {} });\n`,
    );

    const runner = startRunner(entry);
    runners.push(runner);

    await runner.waitFor(/Loaded script-ts/, 1);
    await writeFile(path.join(rootDir, 'shared.ts'), `export const DRUMS = 'bd hh sd hh';\n`);
    await runner.waitFor(/Loaded script-ts/, 2);
  }, 60_000);
});

function startRunner(entryPath: string): Runner {
  const cliPath = path.resolve('packages', 'cli', 'bin', 'tussel.js');
  const child = spawn(process.execPath, [cliPath, 'run', entryPath, '--backend', 'offline'], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  return {
    child,
    getOutput: () => output,
    stop: async () => {
      if (child.exitCode !== null) {
        return;
      }
      child.kill('SIGINT');
      await waitForExit(child);
    },
    waitFor: async (pattern, occurrences = 1, timeoutMs = 15_000) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (countMatches(output, pattern) >= occurrences) {
          return;
        }
        if (child.exitCode !== null) {
          throw new Error(`daemon exited early with code ${child.exitCode}\n${output}`);
        }
        await delay(50);
      }
      throw new Error(`Timed out waiting for ${String(pattern)}\n${output}`);
    },
  };
}

function countMatches(output: string, pattern: string | RegExp): number {
  if (typeof pattern === 'string') {
    return output.split(pattern).length - 1;
  }

  const matches = output.match(
    new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`),
  );
  return matches?.length ?? 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve();
      return;
    }
    child.once('exit', () => resolve());
  });
}
