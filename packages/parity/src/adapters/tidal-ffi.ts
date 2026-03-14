import { translateTidalToStrudelProgram } from '@tussel/runtime';
import type { ExternalFixtureSource, NormalizedEvent } from '../schema.js';
import { queryStrudelEvents } from './strudel.js';

export async function queryTidalEvents(
  source: ExternalFixtureSource,
  options: {
    cps: number;
    durationCycles: number;
  },
): Promise<NormalizedEvent[]> {
  const code = resolveTidalSourceCode(source);
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

export function resolveTidalSourceCode(source: ExternalFixtureSource): string {
  if (source.code) {
    return source.code;
  }
  throw new Error('Parity fixtures currently require inline Tidal code.');
}
