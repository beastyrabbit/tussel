#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distEntryPath = path.join(cliRoot, 'dist', 'index.js');
const sourceEntryPath = path.join(cliRoot, 'src', 'index.ts');

const hasDistEntry = existsSync(distEntryPath);
const hasSourceEntry = existsSync(sourceEntryPath);

if (!hasDistEntry && !hasSourceEntry) {
  console.error(`Tussel CLI build output is missing: expected '${distEntryPath}'.`);
  process.exit(1);
}

const nodeArgs = hasDistEntry
  ? [distEntryPath, ...process.argv.slice(2)]
  : ['--import', 'tsx', sourceEntryPath, ...process.argv.slice(2)];

const child = spawn(process.execPath, nodeArgs, {
  stdio: 'inherit',
  cwd: process.cwd(),
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
