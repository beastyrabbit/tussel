/**
 * Terminal punchcard: render queried events as an ASCII grid.
 *
 * Rows are distinct sound/note values, columns are time slices across the
 * rendered window. A block character marks an onset. Pure string output so
 * both the CLI and tests can use it.
 */

import type { PlaybackEvent } from './types.js';

export interface PunchcardOptions {
  /** Number of cycles covered by the events (default: derived from events). */
  cycles?: number;
  /** Grid width in characters per cycle (default: 16). */
  widthPerCycle?: number;
  /** Character used to mark onsets (default: '█'). */
  mark?: string;
}

function eventLabel(event: PlaybackEvent): string {
  const { payload } = event;
  const sound =
    typeof payload.s === 'string' ? payload.s : typeof payload.sound === 'string' ? payload.sound : undefined;
  if (sound) {
    return sound;
  }
  const note = payload.note ?? payload.n ?? payload.value ?? payload.i;
  if (note !== undefined && note !== null) {
    return `${note}`;
  }
  return '?';
}

/** Render events as an ASCII punchcard grid. */
export function renderPunchcard(events: PlaybackEvent[], options: PunchcardOptions = {}): string {
  if (events.length === 0) {
    return '(no events)';
  }

  const widthPerCycle = Math.max(4, Math.min(options.widthPerCycle ?? 16, 64));
  const derivedCycles = Math.max(...events.map((event) => event.end), 1e-9);
  const cycles = Math.max(1, Math.min(Math.ceil(options.cycles ?? derivedCycles), 32));
  const totalColumns = cycles * widthPerCycle;
  const mark = options.mark ?? '█';

  // Bucket events by label; mark columns whose slice contains an onset.
  const rows = new Map<string, boolean[]>();
  for (const event of events) {
    const label = eventLabel(event);
    let row = rows.get(label);
    if (!row) {
      row = Array.from({ length: totalColumns }, () => false);
      rows.set(label, row);
    }
    const startColumn = Math.floor((event.begin / cycles) * totalColumns);
    const endColumn = Math.max(startColumn + 1, Math.ceil((event.end / cycles) * totalColumns));
    for (let column = startColumn; column < endColumn && column < totalColumns; column += 1) {
      row[column] = true;
    }
  }

  const labels = [...rows.keys()].sort((left, right) => left.localeCompare(right));
  const labelWidth = Math.max(...labels.map((label) => label.length)) + 1;

  const lines: string[] = [];
  for (const label of labels) {
    const row = rows.get(label)!;
    const cells = row.map((on) => (on ? mark : '·')).join('');
    lines.push(`${label.padEnd(labelWidth)}${cells}`);
  }
  lines.push(`${''.padEnd(labelWidth)}${'-'.repeat(totalColumns)}`);
  return lines.join('\n');
}
