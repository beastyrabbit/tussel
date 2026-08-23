/**
 * Named control parameters: live-updatable values addressable from patterns.
 *
 * `createParam('vol')` in the DSL produces a signal bound to `param:vol`;
 * scenes read the current value at query time via {@link getParamValue}, and
 * anything (REPL, CLI, MIDI CC bridge) can update it via {@link setParamValue}
 * without reloading the scene.
 */

import { TusselInputError } from './errors.js';

const PARAM_REGISTRY_KEY = Symbol.for('tussel.paramRegistry');

type ParamValue = boolean | null | number | string;

function paramRegistry(): Map<string, ParamValue> {
  const root = globalThis as typeof globalThis & { [PARAM_REGISTRY_KEY]?: Map<string, ParamValue> };
  root[PARAM_REGISTRY_KEY] ??= new Map<string, ParamValue>();
  return root[PARAM_REGISTRY_KEY]!;
}

/** Canonical registry key for a parameter name. */
export function resolveParamKey(name: string | number): string {
  if (typeof name !== 'string' && typeof name !== 'number') {
    throw new TusselInputError(`Parameter name must be a string or number, received ${typeof name}.`);
  }
  const trimmed = `${name}`.trim();
  if (!trimmed) {
    throw new TusselInputError('Parameter name must not be empty.');
  }
  return `param:${trimmed}`;
}

/** Set the live value of a named parameter. */
export function setParamValue(name: string | number, value: ParamValue): void {
  paramRegistry().set(resolveParamKey(name), value);
}

/** Read the live value of a named parameter, falling back when unset. */
export function getParamValue(name: string | number, fallback: ParamValue = 0): ParamValue {
  return paramRegistry().get(resolveParamKey(name)) ?? fallback;
}

export interface ParamSnapshotEntry {
  name: string;
  value: ParamValue;
}

/** All defined parameters (sorted by name). */
export function getParamSnapshot(): ParamSnapshotEntry[] {
  return [...paramRegistry().entries()]
    .map(([key, value]) => ({ name: key.slice('param:'.length), value }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Clear all parameter values (tests and scene resets). */
export function resetParamValues(): void {
  paramRegistry().clear();
}
