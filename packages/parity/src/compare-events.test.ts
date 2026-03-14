import { describe, expect, it } from 'vitest';
import { compareEvents } from './compare-events.js';
import type { NormalizedEvent } from './schema.js';

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    begin: 0,
    channel: 'main',
    duration: 1,
    end: 1,
    payload: { s: 'bd' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Basic matching
// ---------------------------------------------------------------------------
describe('compareEvents', () => {
  it('empty arrays match', () => {
    const result = compareEvents([], []);
    expect(result.ok).toBe(true);
    expect(result.firstMismatch).toBeUndefined();
  });

  it('identical single events match', () => {
    const event = makeEvent();
    const result = compareEvents([event], [event]);
    expect(result.ok).toBe(true);
  });

  it('identical multiple events match', () => {
    const events = [
      makeEvent({ begin: 0, end: 0.5, duration: 0.5 }),
      makeEvent({ begin: 0.5, end: 1, duration: 0.5 }),
    ];
    const result = compareEvents(events, [...events]);
    expect(result.ok).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Mismatches
  // ---------------------------------------------------------------------------
  it('different begin times do not match', () => {
    const expected = [makeEvent({ begin: 0 })];
    const actual = [makeEvent({ begin: 0.5 })];
    const result = compareEvents(expected, actual);
    expect(result.ok).toBe(false);
    expect(result.firstMismatch).toBeDefined();
    expect(result.firstMismatch?.expected?.begin).toBe(0);
    expect(result.firstMismatch?.actual?.begin).toBe(0.5);
  });

  it('different payloads do not match', () => {
    const expected = [makeEvent({ payload: { s: 'bd' } })];
    const actual = [makeEvent({ payload: { s: 'hh' } })];
    const result = compareEvents(expected, actual);
    expect(result.ok).toBe(false);
    expect(result.firstMismatch).toBeDefined();
  });

  it('different channels do not match', () => {
    const expected = [makeEvent({ channel: 'drums' })];
    const actual = [makeEvent({ channel: 'bass' })];
    const result = compareEvents(expected, actual);
    expect(result.ok).toBe(false);
  });

  it('different durations do not match', () => {
    const expected = [makeEvent({ duration: 1 })];
    const actual = [makeEvent({ duration: 0.5 })];
    const result = compareEvents(expected, actual);
    expect(result.ok).toBe(false);
  });

  it('different end times do not match', () => {
    const expected = [makeEvent({ end: 1 })];
    const actual = [makeEvent({ end: 2 })];
    const result = compareEvents(expected, actual);
    expect(result.ok).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Length mismatches
  // ---------------------------------------------------------------------------
  it('extra event in expected does not match', () => {
    const expected = [makeEvent({ begin: 0 }), makeEvent({ begin: 1 })];
    const actual = [makeEvent({ begin: 0 })];
    const result = compareEvents(expected, actual);
    expect(result.ok).toBe(false);
    expect(result.firstMismatch).toBeDefined();
    expect(result.firstMismatch?.index).toBe(1);
    expect(result.firstMismatch?.expected).toBeDefined();
    expect(result.firstMismatch?.actual).toBeUndefined();
  });

  it('extra event in actual does not match', () => {
    const expected = [makeEvent({ begin: 0 })];
    const actual = [makeEvent({ begin: 0 }), makeEvent({ begin: 1 })];
    const result = compareEvents(expected, actual);
    expect(result.ok).toBe(false);
    expect(result.firstMismatch).toBeDefined();
    expect(result.firstMismatch?.index).toBe(1);
    expect(result.firstMismatch?.actual).toBeDefined();
    expect(result.firstMismatch?.expected).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Sorting behavior
  // ---------------------------------------------------------------------------
  it('events are sorted before comparison (order should not matter)', () => {
    const eventA = makeEvent({ begin: 0, end: 0.5, duration: 0.5 });
    const eventB = makeEvent({ begin: 0.5, end: 1, duration: 0.5 });

    // Expected in order A, B; actual in order B, A
    const result = compareEvents([eventA, eventB], [eventB, eventA]);
    expect(result.ok).toBe(true);
  });

  it('sorts by begin, then end, then channel, then payload', () => {
    const eventA = makeEvent({ begin: 0, end: 1, channel: 'a', payload: { s: 'bd' } });
    const eventB = makeEvent({ begin: 0, end: 1, channel: 'b', payload: { s: 'hh' } });
    const eventC = makeEvent({ begin: 0, end: 2, channel: 'a', payload: { s: 'cp' } });

    // Provide in scrambled order
    const result = compareEvents([eventC, eventA, eventB], [eventB, eventC, eventA]);
    expect(result.ok).toBe(true);
  });

  it('events with same begin but different end are sorted correctly', () => {
    const early = makeEvent({ begin: 0, end: 0.5, duration: 0.5 });
    const late = makeEvent({ begin: 0, end: 1.0, duration: 1.0 });

    const result = compareEvents([late, early], [early, late]);
    expect(result.ok).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Large event arrays
  // ---------------------------------------------------------------------------
  it('large event arrays comparison', () => {
    const events: NormalizedEvent[] = [];
    for (let i = 0; i < 100; i++) {
      events.push(
        makeEvent({
          begin: i * 0.25,
          end: (i + 1) * 0.25,
          duration: 0.25,
          payload: { s: 'bd', n: i },
        }),
      );
    }
    const result = compareEvents(events, [...events]);
    expect(result.ok).toBe(true);
  });

  it('large event arrays with one mismatch at end', () => {
    const expected: NormalizedEvent[] = [];
    const actual: NormalizedEvent[] = [];
    for (let i = 0; i < 50; i++) {
      const event = makeEvent({
        begin: i * 0.5,
        end: (i + 1) * 0.5,
        duration: 0.5,
        payload: { s: 'bd', n: i },
      });
      expected.push(event);
      actual.push(event);
    }
    // Modify last event in actual
    actual[49] = makeEvent({
      begin: 49 * 0.5,
      end: 50 * 0.5,
      duration: 0.5,
      payload: { s: 'hh', n: 49 },
    });
    const result = compareEvents(expected, actual);
    expect(result.ok).toBe(false);
    expect(result.firstMismatch).toBeDefined();
  });

  // ---------------------------------------------------------------------------
  // Events with complex payloads
  // ---------------------------------------------------------------------------
  it('events with complex payloads match when identical', () => {
    const event = makeEvent({
      payload: {
        s: 'pad',
        n: 3,
        gain: 0.8,
        pan: 0.5,
        speed: 1.5,
        cut: 1,
        orbit: 'main',
        active: true,
      },
    });
    const result = compareEvents([event], [{ ...event }]);
    expect(result.ok).toBe(true);
  });

  it('events with complex payloads fail when one field differs', () => {
    const base = {
      s: 'pad',
      n: 3,
      gain: 0.8,
      pan: 0.5,
    };
    const expected = [makeEvent({ payload: { ...base, speed: 1.5 } })];
    const actual = [makeEvent({ payload: { ...base, speed: 2.0 } })];
    const result = compareEvents(expected, actual);
    expect(result.ok).toBe(false);
  });

  it('events with null payload values', () => {
    const event = makeEvent({ payload: { s: 'bd', extra: null } });
    const result = compareEvents([event], [{ ...event }]);
    expect(result.ok).toBe(true);
  });

  it('mismatch result provides correct index', () => {
    const shared = makeEvent({ begin: 0 });
    const expected = [shared, makeEvent({ begin: 1, payload: { s: 'bd' } })];
    const actual = [shared, makeEvent({ begin: 1, payload: { s: 'cp' } })];
    const result = compareEvents(expected, actual);
    expect(result.ok).toBe(false);
    expect(result.firstMismatch?.index).toBe(1);
  });

  it('does not mutate original arrays', () => {
    const eventA = makeEvent({ begin: 1 });
    const eventB = makeEvent({ begin: 0 });
    const expected = [eventA, eventB];
    const actual = [eventA, eventB];
    const expectedCopy = [...expected];
    const actualCopy = [...actual];

    compareEvents(expected, actual);

    // Original arrays should not be mutated (the function uses spread + sort)
    expect(expected).toEqual(expectedCopy);
    expect(actual).toEqual(actualCopy);
  });
});
