import { describe, expect, it } from 'vitest';
import { renderPunchcard } from './punchcard.js';
import type { PlaybackEvent } from './types.js';

function event(begin: number, end: number, sound: string): PlaybackEvent {
  return {
    begin,
    channel: 'd1',
    duration: end - begin,
    end,
    payload: { s: sound },
  };
}

describe('renderPunchcard', () => {
  it('renders empty input', () => {
    expect(renderPunchcard([])).toBe('(no events)');
  });

  it('marks event durations per row and time slice', () => {
    const out = renderPunchcard([event(0, 0.25, 'bd'), event(0.5, 0.75, 'sd'), event(0.25, 0.5, 'bd')], {
      cycles: 1,
      widthPerCycle: 8,
    });
    const [bdRow, sdRow] = out.split('\n');
    expect(bdRow?.startsWith('bd')).toBe(true);
    // bd covers slices 0-0.5, sd covers 0.5-0.75
    expect(bdRow?.slice(3)).toBe('████····');
    expect(sdRow?.slice(3)).toBe('····██··');
  });

  it('sorts rows alphabetically and draws a ruler', () => {
    const out = renderPunchcard([event(0, 0.5, 'zz'), event(0, 0.25, 'aa')], {
      cycles: 1,
      widthPerCycle: 4,
    });
    const lines = out.split('\n');
    expect(lines[0]?.startsWith('aa')).toBe(true);
    expect(lines.at(-1)?.trim()).toMatch(/^-+$/);
  });

  it('spans multiple cycles', () => {
    const out = renderPunchcard([event(1, 1.25, 'hh')], { cycles: 2, widthPerCycle: 8 });
    const row = out.split('\n')[0];
    const grid = row?.slice(3) ?? '';
    expect(grid.length).toBe(16);
    expect(grid.slice(0, 8)).toBe('········');
    expect(grid.slice(8)).toContain('█');
  });
});
