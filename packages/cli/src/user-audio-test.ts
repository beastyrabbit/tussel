#!/usr/bin/env node

import path from 'node:path';
import { checkScene, runScene } from '@tussel/runtime';
import { Command } from 'commander';
import pc from 'picocolors';

const entryPath = path.resolve('examples', 'manual-audio', 'coastline.user-audio.script.ts');

const program = new Command();

program
  .name('user-audio-test')
  .description('Run the manually converted coastline file through the native Tussel audio backend')
  .option('--backend <backend>', 'Audio backend mode', 'realtime')
  .option('--no-watch', 'Disable file watching')
  .action(async (options: { backend: 'offline' | 'realtime'; watch: boolean }) => {
    const prepared = await checkScene(entryPath);
    console.log(pc.cyan(`User audio file: ${entryPath}`));
    console.log(
      pc.cyan(
        `Scene OK: ${Object.keys(prepared.scene.channels).length} channels, ${prepared.scene.samples.length} sample source(s)`,
      ),
    );
    console.log(pc.cyan(`Backend: ${options.backend}. Press Ctrl+C to stop.`));
    await runScene(entryPath, options.watch, options.backend);
  });

void program.parseAsync(process.argv);
