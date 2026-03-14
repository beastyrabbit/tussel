#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  checkScene,
  convertScene,
  importExternalSource,
  type NativeSourceKind,
  renderScene,
  runScene,
} from '@tussel/runtime';
import { Command } from 'commander';
import pc from 'picocolors';

interface CliDeps {
  checkScene: typeof checkScene;
  convertScene: typeof convertScene;
  importExternalSource: typeof importExternalSource;
  log: typeof console.log;
  renderScene: typeof renderScene;
  runScene: typeof runScene;
  stdout: Pick<typeof process.stdout, 'write'>;
  writeFile: typeof writeFile;
}

const defaultDeps: CliDeps = {
  checkScene,
  convertScene,
  importExternalSource,
  log: console.log,
  renderScene,
  runScene,
  stdout: process.stdout,
  writeFile,
};

export function createProgram(deps: CliDeps = defaultDeps): Command {
  const program = new Command();
  program.name('tussel').description('Local-first TypeScript livecoding runtime');

  program
    .command('run')
    .argument('<entry>', 'Entry file (*.script.ts, *.scene.ts, *.scene.json, *.strudel.*, *.tidal)')
    .option('--backend <backend>', 'Audio backend mode', 'realtime')
    .option('--entry <binding-or-root>', 'Select the root binding for external whole-script imports')
    .option('--no-watch', 'Disable file watching (watch is enabled by default)')
    .action(
      async (entry: string, options: { backend: 'offline' | 'realtime'; entry?: string; watch: boolean }) => {
        await deps.runScene(entry, options.watch, options.backend, { entry: options.entry });
      },
    );

  program
    .command('check')
    .argument('<entry>', 'Entry file (*.script.ts, *.scene.ts, *.scene.json, *.strudel.*, *.tidal)')
    .option('--entry <binding-or-root>', 'Select the root binding for external whole-script imports')
    .action(async (entry: string, options: { entry?: string }) => {
      const prepared = await deps.checkScene(entry, { entry: options.entry });
      deps.log(
        pc.green(
          `Scene OK: ${Object.keys(prepared.scene.channels).length} channels, ${prepared.scene.samples.length} sample source(s)`,
        ),
      );
    });

  program
    .command('render')
    .argument('<entry>', 'Entry file (*.script.ts, *.scene.ts, *.scene.json, *.strudel.*, *.tidal)')
    .requiredOption('--out <file>', 'Output WAV file')
    .option('--entry <binding-or-root>', 'Select the root binding for external whole-script imports')
    .option('--seconds <seconds>', 'Render length in seconds', '8')
    .action(async (entry: string, options: { entry?: string; out: string; seconds: string }) => {
      await deps.renderScene(entry, options.out, Number(options.seconds), { entry: options.entry });
      deps.log(pc.green(`Rendered ${options.out}`));
    });

  program
    .command('convert')
    .argument('<entry>', 'Entry file (*.script.ts, *.scene.ts, *.scene.json, *.strudel.*, *.tidal)')
    .requiredOption('--to <kind>', 'Target format: hydra-js | script-ts | scene-ts | scene-json')
    .option('--entry <binding-or-root>', 'Select the root binding for external whole-script imports')
    .option('--out <file>', 'Write output to a file instead of stdout')
    .action(async (entry: string, options: { entry?: string; out?: string; to: NativeSourceKind }) => {
      const rendered = await deps.convertScene(entry, options.to, { entry: options.entry });
      if (options.out) {
        await deps.writeFile(options.out, rendered);
        deps.log(pc.green(`Wrote ${options.out}`));
        return;
      }
      deps.stdout.write(rendered);
    });

  program
    .command('import')
    .argument('<entry>', 'External entry file (*.strudel.js, *.strudel.mjs, *.strudel.ts, *.tidal)')
    .option('--entry <binding-or-root>', 'Select the root binding for external whole-script imports')
    .option('--to <kind>', 'Target format: hydra-js | scene-ts | script-ts | scene-json', 'scene-ts')
    .option('--out <file>', 'Write output to a file instead of stdout')
    .action(async (entry: string, options: { entry?: string; out?: string; to: NativeSourceKind }) => {
      await deps.importExternalSource(entry, { entry: options.entry });
      const rendered = await deps.convertScene(entry, options.to, { entry: options.entry });
      if (options.out) {
        await deps.writeFile(options.out, rendered);
        deps.log(pc.green(`Wrote ${options.out}`));
        return;
      }
      deps.stdout.write(rendered);
    });

  return program;
}

export async function main(argv = process.argv, deps: CliDeps = defaultDeps): Promise<void> {
  await createProgram(deps).parseAsync(argv, { from: 'node' });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void main();
}
