#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

run('node', [path.join(__dirname, 'generate-index.mjs')]);
run('node', [path.join(__dirname, 'describe-files.mjs')]);
