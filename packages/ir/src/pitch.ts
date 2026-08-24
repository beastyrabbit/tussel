/** Pitch helpers shared across packages (IR is the dependency-free base). */

export function midiNoteToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/**
 * Parse a pitch name like `c3`, `a#4`, `eb2`, or a bare letter (`c`, `f#`)
 * into a frequency in Hz. Bare names default to octave 3, matching Strudel
 * (`note("c")` ≡ `note("c3")`). Returns undefined when unrecognized.
 */
export function namedPitchToFrequency(value: string): number | undefined {
  const match = /^([A-Ga-g])([#b]?)(-?\d)?$/.exec(value.trim());
  if (!match) {
    return undefined;
  }
  const [, noteName, accidental, octaveRaw] = match;
  if (!noteName) {
    return undefined;
  }
  const octave = octaveRaw ? Number(octaveRaw) : 3;
  const scale = { A: 9, B: 11, C: 0, D: 2, E: 4, F: 5, G: 7 } as const;
  let semitone = scale[noteName.toUpperCase() as keyof typeof scale];
  if (accidental === '#') {
    semitone += 1;
  } else if (accidental === 'b') {
    semitone -= 1;
  }
  return midiNoteToFrequency((octave + 1) * 12 + semitone);
}
