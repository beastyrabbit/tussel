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
