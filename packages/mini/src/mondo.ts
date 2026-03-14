export interface MondoEvent {
  begin: number;
  end: number;
  value: string;
}

/**
 * Default character-to-sound mapping for mondo drum notation.
 *
 * Each single character maps to a drum sample name. The mapping follows
 * common conventions from drum machine step sequencers and Tidal/Strudel.
 */
const DEFAULT_SOUND_MAP: Record<string, string> = {
  x: 'bd',
  o: 'sd',
  '-': 'hh',
  '=': 'oh',
  '*': 'cp',
  '+': 'cr',
  '^': 'cy',
  '#': 'cb',
  '~': 'rs',
  t: 'tom',
  T: 'tom:1',
  k: 'bd',
  s: 'sd',
  h: 'hh',
  H: 'oh',
  c: 'cp',
  r: 'rim',
};

/**
 * Parse a single line of mondo notation into events for one cycle.
 *
 * A mondo line is a sequence of characters where each non-rest character
 * triggers a sound. The total number of active steps (excluding bar
 * separators) determines the rhythmic grid resolution.
 *
 * - Any character in the sound map triggers that sound.
 * - `.` and `_` are rests (silent steps).
 * - `|` is a bar separator (ignored for timing, purely visual).
 * - Whitespace is stripped.
 *
 * The events are placed evenly across one cycle [0, 1).
 */
function parseMondoLine(line: string, soundMap: Record<string, string> = DEFAULT_SOUND_MAP): MondoEvent[] {
  // Strip whitespace; bar separators are removed but don't affect step count
  const stripped = line.replace(/\s/g, '');
  // Split out bar separators
  const chars = stripped.replace(/\|/g, '');

  if (chars.length === 0) {
    return [];
  }

  const stepCount = chars.length;
  const stepWidth = 1 / stepCount;
  const events: MondoEvent[] = [];

  for (let i = 0; i < stepCount; i++) {
    const ch = chars[i];
    if (!ch || ch === '.' || ch === '_') {
      continue; // rest
    }

    const sound = soundMap[ch];
    if (sound === undefined) {
      continue; // unknown character, treat as rest
    }

    events.push({
      begin: i * stepWidth,
      end: (i + 1) * stepWidth,
      value: sound,
    });
  }

  return events;
}

/**
 * Parse a mondo notation string into events for one cycle.
 *
 * Mondo notation supports:
 * - Single-line patterns: `"x...o...x...o..."` -- characters as drum hits
 * - Bar separators: `"|x...|x.x.|"` -- `|` is visual only, not counted
 * - Multi-line (polyphonic): lines separated by `\n` are stacked
 * - Character mapping: `x`=kick, `o`=snare, `-`=hihat, `=`=open hihat, etc.
 * - Rests: `.` and `_` are silent steps
 *
 * When multiple lines are present, each line is parsed independently and
 * events from all lines are merged (polyphonic stacking).
 */
export function parseMondo(
  source: string,
  soundMap: Record<string, string> = DEFAULT_SOUND_MAP,
): MondoEvent[] {
  const lines = source.split('\n').filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0;
  });

  if (lines.length === 0) {
    return [];
  }

  const events: MondoEvent[] = [];

  for (const line of lines) {
    events.push(...parseMondoLine(line, soundMap));
  }

  return events.sort((a, b) => a.begin - b.begin || a.value.localeCompare(b.value));
}

/**
 * Query mondo notation events within a time range, similar to queryMini.
 *
 * Events are tiled across cycles: each cycle repeats the pattern.
 */
export function queryMondo(
  source: string,
  beginCycle: number,
  endCycle: number,
  soundMap?: Record<string, string>,
): MondoEvent[] {
  const template = parseMondo(source, soundMap);
  if (template.length === 0) {
    return [];
  }

  const firstCycle = Math.floor(beginCycle);
  const lastCycle = Math.max(firstCycle + 1, Math.ceil(endCycle));
  const events: MondoEvent[] = [];

  for (let cycle = firstCycle; cycle < lastCycle; cycle++) {
    for (const event of template) {
      const begin = cycle + event.begin;
      const end = cycle + event.end;

      // Skip events outside the query range
      if (end <= beginCycle || begin >= endCycle) {
        continue;
      }

      events.push({ begin, end, value: event.value });
    }
  }

  return events.sort((a, b) => a.begin - b.begin || a.value.localeCompare(b.value));
}

/**
 * Check if a string looks like mondo notation rather than mini notation.
 *
 * Mondo notation is distinguished by:
 * - Contains mondo-specific characters (x, o, -, =) as drum triggers
 * - Does NOT contain mini notation structural characters like `[`, `]`, `<`, `>`, `*`, `,`
 * - Consists primarily of dots (rests) and trigger characters
 * - Optionally contains `|` bar separators
 *
 * This is a heuristic: ambiguous strings default to mini notation.
 */
export function isMondoNotation(source: string): boolean {
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    return false;
  }

  // If it contains mini notation structural syntax, it's mini
  if (/[[\]<>*,]/.test(trimmed)) {
    return false;
  }

  // If it contains spaces between tokens (not inside bars), it looks like mini
  // Mini notation uses spaces to separate elements: "bd hh sd"
  // Mondo notation is a dense character grid: "x..o..x..o.."
  const withoutBars = trimmed.replace(/\|/g, '');
  const lines = withoutBars
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    // A mondo line should be a contiguous run of mondo characters
    // (no spaces separating tokens -- spaces in mondo are stripped)
    const stripped = line.replace(/\s/g, '');
    if (stripped.length === 0) {
      continue;
    }

    // Every character must be a valid mondo character
    const mondoChars = /^[xo\-=.*_+^#~tTkshHcr|]+$/;
    if (!mondoChars.test(stripped)) {
      return false;
    }

    // Must contain at least one trigger character (not all rests/separators)
    if (!/[xo\-=*+^#~tTkshHcr]/.test(stripped)) {
      return false;
    }
  }

  return true;
}

/**
 * Show first cycle of mondo notation for debugging, similar to showFirstCycle.
 */
export function showMondoFirstCycle(source: string): string[] {
  return queryMondo(source, 0, 1)
    .map((event) => `${event.value}: ${formatNumber(event.begin)} - ${formatNumber(event.end)}`)
    .sort();
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return `${value}`;
  }
  return Number(value.toFixed(6)).toString();
}

/** Re-export the default sound map for custom configurations */
export { DEFAULT_SOUND_MAP };
