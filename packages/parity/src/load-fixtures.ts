import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { LoadedParityFixture, ParityFixture } from './schema.js';

const FIXTURE_ROOT = path.resolve('reference', 'fixtures');

export async function loadFixtures(
  options: { fixtureId?: string; level?: number } = {},
): Promise<LoadedParityFixture[]> {
  const filePaths = await listFixtureFiles(FIXTURE_ROOT);
  const fixtures = await Promise.all(
    filePaths.map(async (fixturePath) => {
      const loaded = (await import(pathToFileURL(fixturePath).href)).default as ParityFixture;
      return { ...loaded, fixturePath };
    }),
  );

  return fixtures
    .filter((fixture) => (options.level ? fixture.level === options.level : true))
    .filter((fixture) => (options.fixtureId ? fixture.id === options.fixtureId : true))
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function listFixtureFiles(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        return listFixtureFiles(entryPath);
      }
      return entry.name.endsWith('.ts') ? [entryPath] : [];
    }),
  );
  return files.flat();
}
