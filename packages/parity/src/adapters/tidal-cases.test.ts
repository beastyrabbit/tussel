import { describe, expect, it } from 'vitest';
import { queryTidalCase, queryTidalCaseEvents } from './tidal-cases.js';

describe('Tidal case registry', () => {
  it('lists fixture-backed tidal cases', async () => {
    const cases = await queryTidalCase();
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.some((entry) => entry.fixtureId === 'level-1/simple-cat')).toBe(true);
  });

  it('loads one tidal case by fixture id', async () => {
    const entry = await queryTidalCase('level-1/simple-cat');
    expect(entry.fixtureId).toBe('level-1/simple-cat');
    expect(entry.source.code).toContain('sound "bd cp"');
  });

  it('queries normalized events for a fixture-backed tidal case', async () => {
    const events = await queryTidalCaseEvents('level-1/simple-cat');
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.payload.s)).toEqual(['bd', 'cp']);
  });
});
