/**
 * Tidal-syntax adapter.
 *
 * IMPORTANT: This adapter does NOT invoke real Tidal (GHC/Haskell).
 * It translates Tidal-syntax source into Strudel JS and queries Strudel
 * for events. This means "Tidal parity" is actually "Tidal-to-Strudel
 * translation parity" — it validates the translation layer, not real
 * Tidal semantics.
 *
 * To validate against real Tidal, a proper FFI/subprocess adapter calling
 * the Haskell runtime would be needed. Until then, treat results from this
 * adapter as Strudel-mediated, not Tidal-authoritative.
 */
import { translateTidalToStrudelProgram } from '@tussel/runtime';
import type { ExternalFixtureSource, NormalizedEvent } from '../schema.js';
import { queryStrudelEvents } from './strudel.js';

/**
 * Query events for Tidal-syntax source by translating to Strudel first.
 *
 * NOTE: Results reflect Strudel's interpretation of the translated code,
 * not real Tidal semantics. See module-level comment.
 */
export async function queryTidalEvents(
  source: ExternalFixtureSource,
  options: {
    cps: number;
    durationCycles: number;
  },
): Promise<NormalizedEvent[]> {
  const code = await resolveTidalSourceCode(source);
  const translated = translateTidalToStrudelProgram(code, { entry: source.entry });
  const events = await Promise.all(
    translated.channels.map(({ channel, expr }) =>
      queryStrudelEvents(expr, {
        channel,
        cps: options.cps,
        durationCycles: options.durationCycles,
      }),
    ),
  );
  return events
    .flat()
    .sort(
      (left, right) =>
        left.begin - right.begin ||
        left.end - right.end ||
        left.channel.localeCompare(right.channel) ||
        JSON.stringify(left.payload).localeCompare(JSON.stringify(right.payload)),
    );
}

export async function resolveTidalSourceCode(source: ExternalFixtureSource): Promise<string> {
  if (source.code) {
    return source.code;
  }
  if (source.path) {
    const { readFile } = await import('node:fs/promises');
    const nodePath = await import('node:path');
    return readFile(nodePath.default.resolve(source.path), 'utf8');
  }
  throw new Error('Parity fixture source requires either code or path.');
}
