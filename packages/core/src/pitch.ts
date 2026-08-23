import { Chord, Interval, Note, Scale } from '@tonaljs/tonal';
import { coerceFiniteNumber, type ExpressionValue } from '@tussel/ir';
import { evaluateNumericValue, resolvePropertyValue } from './evaluate.js';
import type { InternalQueryContext } from './index.js';
import type { PlaybackEvent } from './types.js';
import { clampNumber, positiveMod } from './utils.js';

export function applyRootNotes(
  currentEvents: PlaybackEvent[],
  octaveExpr: ExpressionValue | undefined,
): PlaybackEvent[] {
  const octave = resolveOctave(octaveExpr, 2);
  return currentEvents.map((event) => {
    const chordSymbol = resolveChordSymbol(event.payload);
    const root = chordSymbol ? renderChordRoot(chordSymbol, octave) : undefined;
    return root ? { ...event, payload: { ...event.payload, note: root } } : event;
  });
}

export function applyScale(
  currentEvents: PlaybackEvent[],
  scaleExpr: ExpressionValue | undefined,
  begin: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const scaleName = resolvePropertyValue(scaleExpr, begin, context.cps);
  if (typeof scaleName !== 'string' || scaleName.trim() === '') {
    return currentEvents;
  }

  return currentEvents.map((event) => {
    const pitchKey = resolvePitchKey(event.payload);
    if (!pitchKey) {
      return event;
    }
    const scaled = scalePitchValue(event.payload[pitchKey], scaleName, event.payload.anchor);
    return scaled === undefined
      ? event
      : { ...event, payload: { ...event.payload, [pitchKey]: scaled, scale: scaleName } };
  });
}

export function applyScaleTranspose(
  currentEvents: PlaybackEvent[],
  stepsExpr: ExpressionValue | undefined,
  begin: number,
  _context: InternalQueryContext,
): PlaybackEvent[] {
  // Fallback 0 = no transposition; safe identity since shifting by 0 scale degrees is a no-op
  const steps = evaluateNumericValue(stepsExpr, begin) ?? 0;
  return currentEvents.map((event) => {
    const scaleName = typeof event.payload.scale === 'string' ? event.payload.scale : undefined;
    const pitchKey = resolvePitchKey(event.payload);
    if (!scaleName || !pitchKey) {
      return event;
    }
    const shifted = transposePitchInScale(event.payload[pitchKey], scaleName, steps);
    return shifted === undefined ? event : { ...event, payload: { ...event.payload, [pitchKey]: shifted } };
  });
}

export function applyTranspose(
  currentEvents: PlaybackEvent[],
  amountExpr: ExpressionValue | undefined,
  begin: number,
  context: InternalQueryContext,
): PlaybackEvent[] {
  const amount = resolvePropertyValue(amountExpr, begin, context.cps);
  return currentEvents.map((event) => {
    const pitchKey = resolvePitchKey(event.payload);
    if (!pitchKey) {
      return event;
    }
    const shifted = transposePitch(event.payload[pitchKey], amount);
    return shifted === undefined ? event : { ...event, payload: { ...event.payload, [pitchKey]: shifted } };
  });
}

export function applyVoicing(currentEvents: PlaybackEvent[]): PlaybackEvent[] {
  return currentEvents.flatMap((event) => {
    const chordSymbol = resolveChordSymbol(event.payload);
    if (!chordSymbol) {
      return [event];
    }

    const mode = typeof event.payload.mode === 'string' ? event.payload.mode : undefined;
    if (mode?.startsWith('root:')) {
      const anchorOctave = Note.get(mode.slice('root:'.length).trim()).oct ?? 2;
      const root = renderChordRoot(chordSymbol, anchorOctave);
      return root ? [{ ...event, payload: { ...event.payload, note: root } }] : [event];
    }

    const dictionary = typeof event.payload.dict === 'string' ? event.payload.dict : undefined;
    const notes = renderChordVoicing(chordSymbol, dictionary, event.payload.anchor, mode);
    if (notes.length === 0) {
      return [event];
    }

    const noteIndex = resolveVoicingIndex(event.payload);
    if (noteIndex !== undefined) {
      const note = noteAtIndex(notes, noteIndex);
      return note ? [{ ...event, payload: { ...event.payload, note } }] : [event];
    }

    return notes.map((note) => ({
      ...event,
      payload: { ...event.payload, note },
    }));
  });
}

function resolvePitchKey(payload: Record<string, unknown>): 'n' | 'note' | 'value' | undefined {
  if (payload.note !== undefined) {
    return 'note';
  }
  if (payload.n !== undefined) {
    return 'n';
  }
  if (payload.value !== undefined) {
    return 'value';
  }
  return undefined;
}

function resolveOctave(value: ExpressionValue | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const numeric = Number(value.trim());
    if (Number.isFinite(numeric)) {
      return Math.trunc(numeric);
    }
  }
  return fallback;
}

function scalePitchValue(
  value: unknown,
  scaleName: string,
  anchorValue?: unknown,
): number | string | undefined {
  const anchorMidi = resolveAnchorMidi(anchorValue);
  if (anchorMidi !== undefined) {
    return scalePitchValueWithAnchor(value, scaleName, anchorMidi);
  }
  if (typeof value === 'number' || (typeof value === 'string' && /^-?\d+[#b]*$/.test(value.trim()))) {
    return degreeToScaleNote(value, scaleName);
  }
  if (typeof value === 'string' && isScientificPitch(value)) {
    return quantizePitchToScale(value, scaleName);
  }
  return undefined;
}

function scalePitchValueWithAnchor(
  value: unknown,
  scaleName: string,
  anchorMidi: number,
): number | string | undefined {
  const parsed = typeof value === 'number' || typeof value === 'string' ? parseScaleDegree(value) : undefined;
  if (parsed) {
    return degreeToAnchoredScaleMidi(parsed, scaleName, anchorMidi);
  }
  if (typeof value === 'string' && isScientificPitch(value)) {
    return quantizePitchToScale(value, scaleName);
  }
  return undefined;
}

function transposePitchInScale(
  value: unknown,
  scaleName: string,
  steps: number,
): string | number | undefined {
  if (typeof value === 'number') {
    return value + steps;
  }
  if (typeof value === 'string' && /^-?\d+[#b]*$/.test(value.trim())) {
    const numeric = Number.parseInt(value.trim(), 10);
    return degreeToScaleNote(numeric + Math.trunc(steps), scaleName);
  }
  if (typeof value === 'string' && isScientificPitch(value)) {
    const midi = Note.midi(value);
    if (midi === null) {
      return undefined;
    }
    const scaleMidis = enumerateScaleMidis(scaleName, midi - 24, midi + 24);
    if (scaleMidis.length === 0) {
      return undefined;
    }
    const target = scaleMidis[nearestIndex(scaleMidis, midi) + Math.trunc(steps)];
    return target === undefined ? undefined : Note.fromMidiSharps(target);
  }
  return undefined;
}

function transposePitch(value: unknown, amount: unknown): string | number | undefined {
  if (typeof value === 'number') {
    const numeric = typeof amount === 'number' ? amount : Number(amount);
    return Number.isFinite(numeric) ? value + numeric : undefined;
  }
  if (typeof value === 'string' && isScientificPitch(value)) {
    if (typeof amount === 'string' && /[PMAmd]/.test(amount)) {
      return Note.transpose(value, amount);
    }
    const numeric = typeof amount === 'number' ? amount : Number(amount);
    return Number.isFinite(numeric) ? Note.transpose(value, Interval.fromSemitones(numeric)) : undefined;
  }
  return undefined;
}

function degreeToScaleNote(value: string | number, scaleName: string): string | undefined {
  const parsed = parseScaleDegree(value);
  const scale = resolveScale(scaleName);
  if (!parsed || scale.empty) {
    return undefined;
  }

  const tonic = ensureOctave(scale.tonic || 'C', 3);
  const index = positiveMod(parsed.step, scale.intervals.length);
  const interval = scale.intervals[index] ?? '1P';
  let note = Note.transpose(tonic, interval);

  const octaveShift = Math.floor(parsed.step / scale.intervals.length);
  if (octaveShift !== 0) {
    note = Note.transpose(note, Interval.fromSemitones(octaveShift * 12));
  }
  if (parsed.accidentalOffset !== 0) {
    note = Note.transpose(note, Interval.fromSemitones(parsed.accidentalOffset));
  }
  return note;
}

function degreeToAnchoredScaleMidi(
  parsed: { accidentalOffset: number; step: number },
  scaleName: string,
  anchorMidi: number,
): number | undefined {
  const scaleMidis = enumerateScaleMidis(scaleName, anchorMidi - 72, anchorMidi + 72);
  if (scaleMidis.length === 0) {
    return undefined;
  }

  const baseIndex = nearestScaleIndexBelowAnchor(scaleMidis, anchorMidi);
  const target = scaleMidis[baseIndex + parsed.step];
  return target === undefined ? undefined : target + parsed.accidentalOffset;
}

function quantizePitchToScale(note: string, scaleName: string): string | undefined {
  const midi = Note.midi(note);
  if (midi === null) {
    return undefined;
  }
  const scaleMidis = enumerateScaleMidis(scaleName, midi - 24, midi + 24);
  if (scaleMidis.length === 0) {
    return undefined;
  }
  const nearest = scaleMidis[nearestIndex(scaleMidis, midi)];
  return nearest === undefined ? undefined : Note.fromMidiSharps(nearest);
}

function resolveScale(scaleName: string) {
  return Scale.get(scaleName.replaceAll(':', ' ').trim());
}

function parseScaleDegree(value: string | number): { accidentalOffset: number; step: number } | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { accidentalOffset: 0, step: Math.trunc(value) };
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = /^(-?\d+)([#b]*)$/.exec(value.trim());
  if (!match) {
    return undefined;
  }
  return {
    accidentalOffset: [...(match[2] ?? '')].reduce(
      (sum, accidental) => sum + (accidental === '#' ? 1 : -1),
      0,
    ),
    step: Number(match[1]),
  };
}

function isScientificPitch(value: string): boolean {
  return Note.midi(value) !== null;
}

function enumerateScaleMidis(scaleName: string, minMidi: number, maxMidi: number): number[] {
  const scale = resolveScale(scaleName);
  if (scale.empty) {
    return [];
  }
  const values: number[] = [];
  for (let octave = -1; octave <= 9; octave += 1) {
    for (const note of scale.notes) {
      const midi = Note.midi(`${Note.get(note).pc || note}${octave}`);
      if (midi !== null && midi >= minMidi && midi <= maxMidi) {
        values.push(midi);
      }
    }
  }
  return values.sort((left, right) => left - right);
}

function nearestScaleIndexBelowAnchor(values: number[], anchorMidi: number): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if ((values[index] ?? Number.POSITIVE_INFINITY) <= anchorMidi) {
      return index;
    }
  }
  return 0;
}

function nearestIndex(values: number[], target: number): number {
  let bestIndex = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let index = 0; index < values.length; index += 1) {
    const delta = Math.abs((values[index] ?? target) - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function resolveChordSymbol(payload: Record<string, unknown>): string | undefined {
  const chord = payload.chord ?? payload.value;
  return typeof chord === 'string' && chord.trim() !== '' ? chord.trim() : undefined;
}

function renderChordRoot(chordSymbol: string, octave: number): string | undefined {
  const chord = Chord.get(chordSymbol);
  if (!chord.tonic) {
    return undefined;
  }
  return `${Note.get(chord.tonic).pc || chord.tonic}${octave}`;
}

function renderChordVoicing(
  chordSymbol: string,
  dictionary = 'ireal',
  anchorValue?: unknown,
  mode = 'below',
): string[] {
  const chord = Chord.get(chordSymbol);
  if (chord.empty || !chord.tonic) {
    return [];
  }

  const baseOctave = dictionary === 'lefthand' ? 3 : 4;
  const root = ensureOctave(chord.tonic, baseOctave);
  const notes = chord.intervals.map((interval) => Note.transpose(root, interval));
  if (notes.length === 0) {
    return [];
  }

  switch (dictionary) {
    case 'guidetones':
      return alignVoicingToAnchor(selectVoicingNotes(notes, [1, 3]), anchorValue, mode);
    case 'lefthand':
      return alignVoicingToAnchor(
        selectVoicingNotes(notes, [1, 3, 4, 5]).map((note) =>
          Note.transpose(note, Interval.fromSemitones(-12)),
        ),
        anchorValue,
        mode,
      );
    case 'triads':
      return alignVoicingToAnchor(selectVoicingNotes(notes, [0, 1, 2]), anchorValue, mode);
    default:
      return alignVoicingToAnchor(selectVoicingNotes(notes, [1, 3, 4, 2, 0]).slice(0, 4), anchorValue, mode);
  }
}

function alignVoicingToAnchor(notes: string[], anchorValue?: unknown, mode = 'below'): string[] {
  const anchorMidi = resolveAnchorMidi(anchorValue);
  if (anchorMidi === undefined || notes.length <= 1) {
    return notes;
  }

  const noteMidis = notes
    .map((note) => Note.midi(note))
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  if (noteMidis.length !== notes.length) {
    return notes;
  }

  const candidates = buildVoicingCandidates(noteMidis);
  const selected =
    pickAnchoredVoicing(candidates, anchorMidi, mode) ??
    pickAnchoredVoicing(candidates, anchorMidi, 'below') ??
    candidates[0];
  return selected?.map((midi) => Note.fromMidiSharps(midi)).filter((note) => note.length > 0) ?? notes;
}

function buildVoicingCandidates(noteMidis: number[]): number[][] {
  const inversions = noteMidis.map((_, rotationIndex) => {
    const rotated = noteMidis.slice(rotationIndex).concat(noteMidis.slice(0, rotationIndex));
    const inversion: number[] = [];
    let floor = Number.NEGATIVE_INFINITY;
    for (const midi of rotated) {
      let current = midi;
      while (current <= floor) {
        current += 12;
      }
      inversion.push(current);
      floor = current;
    }
    return inversion;
  });

  const candidates: number[][] = [];
  for (const inversion of inversions) {
    for (let octaveShift = -3; octaveShift <= 3; octaveShift += 1) {
      candidates.push(inversion.map((midi) => midi + octaveShift * 12));
    }
  }
  return candidates;
}

function pickAnchoredVoicing(candidates: number[][], anchorMidi: number, mode: string): number[] | undefined {
  const normalizedMode = mode === 'above' || mode === 'duck' ? mode : 'below';
  const scored = candidates
    .map((candidate) => ({
      candidate,
      max: candidate[candidate.length - 1] ?? Number.NEGATIVE_INFINITY,
      min: candidate[0] ?? Number.POSITIVE_INFINITY,
    }))
    .filter(({ max, min }) => {
      switch (normalizedMode) {
        case 'above':
          return min >= anchorMidi;
        case 'duck':
          return max < anchorMidi;
        default:
          return max <= anchorMidi;
      }
    })
    .sort((left, right) => {
      const leftDistance =
        normalizedMode === 'above' ? left.min - anchorMidi : Math.abs(anchorMidi - left.max);
      const rightDistance =
        normalizedMode === 'above' ? right.min - anchorMidi : Math.abs(anchorMidi - right.max);
      return leftDistance - rightDistance || left.max - right.max || left.min - right.min;
    });

  return scored[0]?.candidate;
}

function resolveAnchorMidi(anchorValue: unknown): number | undefined {
  if (typeof anchorValue === 'number' && Number.isFinite(anchorValue)) {
    return Math.round(anchorValue);
  }
  if (typeof anchorValue !== 'string') {
    return undefined;
  }
  const trimmed = anchorValue.trim();
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return Math.round(numeric);
  }
  const midi = Note.midi(trimmed);
  return midi === null ? undefined : midi;
}

function selectVoicingNotes(notes: string[], preferredIndices: number[]): string[] {
  const selected: string[] = [];
  for (const index of preferredIndices) {
    const note = notes[index];
    if (note && !selected.includes(note)) {
      selected.push(note);
    }
  }
  return selected.length > 0 ? selected : notes;
}

function resolveVoicingIndex(payload: Record<string, unknown>): number | undefined {
  const value = payload.n ?? (typeof payload.note === 'number' ? payload.note : undefined);
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

function noteAtIndex(notes: string[], index: number): string | undefined {
  if (notes.length === 0) {
    return undefined;
  }
  const wrapped = positiveMod(index, notes.length);
  const octaveShift = Math.floor(index / notes.length);
  const selected = notes[wrapped];
  return selected === undefined
    ? undefined
    : octaveShift === 0
      ? selected
      : Note.transpose(selected, Interval.fromSemitones(octaveShift * 12));
}

function ensureOctave(note: string, octave: number): string {
  const parsed = Note.get(note);
  return `${parsed.pc || note}${parsed.oct ?? octave}`;
}
