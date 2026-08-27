import { TusselInputError } from './errors.js';

export type InputValue = boolean | null | number | string;

const INPUT_REGISTRY_KEY = Symbol.for('tussel.inputRegistry');

function inputRegistry(): Map<string, InputValue> {
  const root = globalThis as typeof globalThis & { [INPUT_REGISTRY_KEY]?: Map<string, InputValue> };
  root[INPUT_REGISTRY_KEY] ??= new Map<string, InputValue>();
  return root[INPUT_REGISTRY_KEY];
}

export function resetInputRegistry(): void {
  inputRegistry().clear();
}

export function setInputValue(name: string, value: InputValue): void {
  inputRegistry().set(normalizeInputKey(name), value);
}

export function getInputValue(name: string, fallback: InputValue = 0): InputValue {
  return inputRegistry().get(normalizeInputKey(name)) ?? fallback;
}

export function getInputSnapshot(): Record<string, InputValue> {
  return Object.fromEntries(
    [...inputRegistry().entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function resolveInputKey(name: string): string {
  return normalizeInputKey(name);
}

export function resolveMidiInputKey(control: string | number, port = 'default'): string {
  return normalizeInputKey(`midi:${`${port}`.trim()}:${`${control}`.trim()}`);
}

export function resolveGamepadInputKey(control: string, index = 0): string {
  return normalizeInputKey(`gamepad:${Math.max(0, Math.trunc(index))}:${control}`);
}

export function resolveMotionInputKey(axis: string): string {
  return normalizeInputKey(`motion:${axis}`);
}

export function setMidiValue(control: string | number, value: InputValue, port = 'default'): void {
  setInputValue(resolveMidiInputKey(control, port), value);
}

export function setGamepadValue(control: string, value: InputValue, index = 0): void {
  setInputValue(resolveGamepadInputKey(control, index), value);
}

export function setMotionValue(axis: string, value: InputValue): void {
  setInputValue(resolveMotionInputKey(axis), value);
}

// ---------------------------------------------------------------------------
// MIDI note state (for midin() / midikeys() signals)
// ---------------------------------------------------------------------------

const MIDI_HELD_NOTES_KEY = Symbol.for('tussel.midiHeldNotes');

function midiHeldNotes(): Map<string, Set<number>> {
  const root = globalThis as typeof globalThis & { [MIDI_HELD_NOTES_KEY]?: Map<string, Set<number>> };
  root[MIDI_HELD_NOTES_KEY] ??= new Map<string, Set<number>>();
  return root[MIDI_HELD_NOTES_KEY];
}

/** Registry key holding the most recent note-on pitch for a port. */
const NOTE_KEY_CONTROL = 'note';
/** Registry key holding the count of currently held notes for a port. */
const KEYS_KEY_CONTROL = 'keys';

/**
 * Record a MIDI note-on: tracks the note as held and publishes both the
 * latest pitch (`midin()`) and the held-note count (`midikeys()`) to the
 * input registry.
 */
export function setMidiNoteOn(note: number, velocity = 127, port: string | number = 'default'): void {
  const normalizedPort = `${port}`.trim() || 'default';
  const normalizedNote = Math.trunc(note);
  const normalizedVelocity = Math.max(0, Math.min(127, velocity));
  const held = midiHeldNotes().get(normalizedPort) ?? new Set<number>();
  held.add(normalizedNote);
  midiHeldNotes().set(normalizedPort, held);
  setMidiValue(`note:${normalizedNote}`, normalizedVelocity / 127, normalizedPort);
  setMidiValue('velocity', normalizedVelocity / 127, normalizedPort);
  setMidiValue(NOTE_KEY_CONTROL, normalizedNote, normalizedPort);
  setMidiValue(KEYS_KEY_CONTROL, held.size, normalizedPort);
}

/** Record a MIDI note-off: releases the note and refreshes the held-note count. */
export function setMidiNoteOff(note: number, port: string | number = 'default'): void {
  const normalizedPort = `${port}`.trim() || 'default';
  const normalizedNote = Math.trunc(note);
  const held = midiHeldNotes().get(normalizedPort) ?? new Set<number>();
  held.delete(normalizedNote);
  if (held.size === 0) {
    midiHeldNotes().delete(normalizedPort);
  } else {
    midiHeldNotes().set(normalizedPort, held);
  }
  setMidiValue(`note:${normalizedNote}`, 0, normalizedPort);
  setMidiValue(KEYS_KEY_CONTROL, held.size, normalizedPort);
}

/** Currently held note numbers for a port (unordered copy). */
export function getHeldMidiNotes(port: string | number = 'default'): number[] {
  const held = midiHeldNotes().get(`${port}`.trim() || 'default');
  return held ? [...held] : [];
}

/** Clear all MIDI note tracking state (used by tests and scene resets). */
export function resetMidiNoteState(): void {
  midiHeldNotes().clear();
}

function normalizeInputKey(name: string): string {
  if (typeof name !== 'string') {
    throw new TusselInputError(`Input key must be a string, received ${typeof name}.`);
  }

  const trimmed = name.trim();
  if (!trimmed) {
    throw new TusselInputError('Input key must not be empty.');
  }

  return trimmed;
}
