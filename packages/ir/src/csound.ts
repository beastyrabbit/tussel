import { TusselInputError } from './errors.js';

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
    throw new TusselInputError('loadOrc: expected url string');
  }

  const trimmed = url.trim();
  if (trimmed.startsWith('github:')) {
    return `https://raw.githubusercontent.com/${trimmed.slice('github:'.length)}`;
  }
  return trimmed;
}

const ORC_FETCH_TIMEOUT_MS = 15_000;
const ORC_MAX_SIZE_BYTES = 1_024 * 1_024; // 1 MB

export async function loadOrc(url: string): Promise<void> {
  const resolvedUrl = resolveOrcUrl(url);
  const pending =
    sourceLoads().get(resolvedUrl) ??
    (async () => {
      if (typeof fetch !== 'function') {
        throw new TusselInputError(`loadOrc: fetch is unavailable for ${resolvedUrl}`);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ORC_FETCH_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(resolvedUrl, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        throw new TusselInputError(
          `loadOrc: failed to fetch ${resolvedUrl} (${response.status} ${response.statusText})`,
        );
      }

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType && !contentType.includes('text') && !contentType.includes('octet-stream')) {
        throw new TusselInputError(`loadOrc: unexpected content-type "${contentType}" for ${resolvedUrl}`);
      }

      const contentLength = response.headers.get('content-length');
      if (contentLength && Number(contentLength) > ORC_MAX_SIZE_BYTES) {
        throw new TusselInputError(
          `loadOrc: response too large (${contentLength} bytes, limit ${ORC_MAX_SIZE_BYTES}) for ${resolvedUrl}`,
        );
      }

      const code = await response.text();
      if (code.length > ORC_MAX_SIZE_BYTES) {
        throw new TusselInputError(
          `loadOrc: body too large (${code.length} bytes, limit ${ORC_MAX_SIZE_BYTES}) for ${resolvedUrl}`,
        );
      }
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
