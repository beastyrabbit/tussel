export interface CsoundInstrumentSpec {
  body: string;
  name: string;
  source: string;
}

const INSTRUMENT_REGISTRY_KEY = Symbol.for('tussel.csoundInstrumentRegistry');
const SOURCE_LOADS_KEY = Symbol.for('tussel.csoundSourceLoads');

function instrumentRegistry(): Map<string, CsoundInstrumentSpec> {
  const root = globalThis as typeof globalThis & {
    [INSTRUMENT_REGISTRY_KEY]?: Map<string, CsoundInstrumentSpec>;
  };
  root[INSTRUMENT_REGISTRY_KEY] ??= new Map<string, CsoundInstrumentSpec>();
  return root[INSTRUMENT_REGISTRY_KEY];
}

function sourceLoads(): Map<string, Promise<void>> {
  const root = globalThis as typeof globalThis & {
    [SOURCE_LOADS_KEY]?: Map<string, Promise<void>>;
  };
  root[SOURCE_LOADS_KEY] ??= new Map<string, Promise<void>>();
  return root[SOURCE_LOADS_KEY];
}

export function resetCsoundRegistry(): void {
  instrumentRegistry().clear();
  sourceLoads().clear();
}

export function listCsoundInstruments(): string[] {
  return [...instrumentRegistry().keys()].sort((left, right) => left.localeCompare(right));
}

export function getCsoundInstrument(name: string | number): CsoundInstrumentSpec | undefined {
  const key = `${name}`.trim();
  if (!key) {
    return undefined;
  }
  const spec = instrumentRegistry().get(key);
  return spec ? { ...spec } : undefined;
}

export function hasCsoundInstrument(name: string | number): boolean {
  return getCsoundInstrument(name) !== undefined;
}

export function parseCsoundInstruments(code: string, source = 'inline'): CsoundInstrumentSpec[] {
  const instruments: CsoundInstrumentSpec[] = [];
  const pattern = /^\s*instr\s+([^\s;]+)\s*$([\s\S]*?)^\s*endin\b/gim;

  for (const match of code.matchAll(pattern)) {
    const name = match[1]?.trim();
    if (!name) {
      continue;
    }
    instruments.push({
      body: match[2]?.trim() ?? '',
      name,
      source,
    });
  }

  return instruments;
}

export function registerCsoundCode(code: string, source = 'inline'): string[] {
  const normalized = `${code}`;
  const parsed = parseCsoundInstruments(normalized, source);
  for (const instrument of parsed) {
    instrumentRegistry().set(instrument.name, instrument);
  }
  return parsed.map((instrument) => instrument.name);
}

export function resolveOrcUrl(url: string): string {
  if (typeof url !== 'string' || url.trim() === '') {
    throw new Error('loadOrc: expected url string');
  }

  const trimmed = url.trim();
  if (trimmed.startsWith('github:')) {
    return `https://raw.githubusercontent.com/${trimmed.slice('github:'.length)}`;
  }
  return trimmed;
}

export async function loadOrc(url: string): Promise<void> {
  const resolvedUrl = resolveOrcUrl(url);
  const pending =
    sourceLoads().get(resolvedUrl) ??
    (async () => {
      if (typeof fetch !== 'function') {
        throw new Error(`loadOrc: fetch is unavailable for ${resolvedUrl}`);
      }

      const response = await fetch(resolvedUrl);
      if (!response.ok) {
        throw new Error(
          `loadOrc: failed to fetch ${resolvedUrl} (${response.status} ${response.statusText})`,
        );
      }

      const code = await response.text();
      registerCsoundCode(code, resolvedUrl);
    })();

  sourceLoads().set(resolvedUrl, pending);
  await pending;
}

function renderTemplatedCode(strings: TemplateStringsArray | string, values: unknown[]): string {
  if (typeof strings === 'string') {
    return strings;
  }

  return strings.reduce((acc, chunk, index) => {
    const value = index < values.length ? values[index] : '';
    return `${acc}${chunk}${value ?? ''}`;
  }, '');
}

export async function loadCsound(
  strings: TemplateStringsArray | string,
  ...values: unknown[]
): Promise<void> {
  registerCsoundCode(renderTemplatedCode(strings, values));
}

/** @deprecated Use `loadCsound` instead. Compatibility alias. */
export const loadCSound = loadCsound;
/** @deprecated Use `loadCsound` instead. Compatibility alias. */
export const loadcsound = loadCsound;
