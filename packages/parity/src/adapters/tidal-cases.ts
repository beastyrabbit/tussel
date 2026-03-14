import { loadFixtures } from '../load-fixtures.js';
import type { ExternalFixtureSource, LoadedParityFixture, NormalizedEvent } from '../schema.js';
import { queryTidalEvents } from './tidal-via-strudel.js';

export interface TidalCaseRecord {
  cps: number;
  durationCycles: number;
  fixtureId: string;
  level: LoadedParityFixture['level'];
  shape: ExternalFixtureSource['shape'];
  source: ExternalFixtureSource;
  title: string;
}

export async function queryTidalCase(): Promise<TidalCaseRecord[]>;
export async function queryTidalCase(fixtureId: string): Promise<TidalCaseRecord>;
export async function queryTidalCase(fixtureId?: string): Promise<TidalCaseRecord | TidalCaseRecord[]> {
  const registry = await listTidalCases();
  if (!fixtureId) {
    return registry;
  }
  const match = registry.find((entry) => entry.fixtureId === fixtureId);
  if (!match) {
    throw new Error(`Unknown Tidal parity case: ${fixtureId}`);
  }
  return match;
}

export async function queryTidalCaseEvents(fixtureId: string): Promise<NormalizedEvent[]> {
  const registryEntry = await queryTidalCase(fixtureId);
  if (Array.isArray(registryEntry)) {
    throw new Error(`Expected a single Tidal parity case for ${fixtureId}`);
  }
  return queryTidalEvents(registryEntry.source, {
    cps: registryEntry.cps,
    durationCycles: registryEntry.durationCycles,
  });
}

async function listTidalCases(): Promise<TidalCaseRecord[]> {
  const fixtures = await loadFixtures();
  return fixtures
    .flatMap((fixture) => {
      if (!fixture.sources.tidal) {
        return [];
      }
      return [toTidalCaseRecord(fixture)];
    })
    .sort((left, right) => left.fixtureId.localeCompare(right.fixtureId));
}

function toTidalCaseRecord(fixture: LoadedParityFixture): TidalCaseRecord {
  const source = fixture.sources.tidal;
  if (!source) {
    throw new Error(`Fixture ${fixture.id} does not define a Tidal source.`);
  }
  return {
    cps: fixture.cps,
    durationCycles: fixture.durationCycles,
    fixtureId: fixture.id,
    level: fixture.level,
    shape: source.shape,
    source,
    title: fixture.title,
  };
}
