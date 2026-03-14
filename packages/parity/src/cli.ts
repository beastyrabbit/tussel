#!/usr/bin/env node

import { main } from './index.js';

void main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
