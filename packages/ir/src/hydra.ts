import { TusselHydraError } from './errors.js';

export interface HydraProgramSpec {
  code: string;
}

export interface HydraSceneSpec {
  options: Record<string, unknown>;
  programs: HydraProgramSpec[];
}

export function normalizeHydraSceneSpec(value: unknown): HydraSceneSpec | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const options =
    record.options && typeof record.options === 'object' && !Array.isArray(record.options)
      ? { ...(record.options as Record<string, unknown>) }
      : {};
  const programs = Array.isArray(record.programs)
    ? record.programs
        .flatMap((entry) =>
          entry &&
          typeof entry === 'object' &&
          !Array.isArray(entry) &&
          typeof (entry as { code?: unknown }).code === 'string'
            ? [{ code: `${(entry as { code: string }).code}` }]
            : [],
        )
        .filter((entry) => entry.code.trim().length > 0)
    : [];

  if (programs.length === 0 && Object.keys(options).length === 0) {
    return undefined;
  }

  return { options, programs };
}

export function renderHydraTemplate(strings: TemplateStringsArray | string, values: unknown[]): string {
  if (typeof strings === 'string') {
    return strings;
  }

  return strings.reduce(
    (acc, chunk, index) => `${acc}${chunk}${index < values.length ? (values[index] ?? '') : ''}`,
    '',
  );
}

export function renderHydraPatternReference(value: unknown): string {
  if (value === undefined) {
    throw new TusselHydraError('H() requires a value or pattern reference.');
  }
  return `H(${typeof value === 'string' ? JSON.stringify(value) : String(value)})`;
}
