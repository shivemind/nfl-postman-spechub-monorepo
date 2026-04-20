#!/usr/bin/env node

import path from 'node:path';
import { appendGithubOutput, printJson, scanSpecFiles } from './lib.mjs';

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current.startsWith('--')) {
      continue;
    }

    const key = current.slice(2);
    const next = argv[index + 1];

    if (!next || next.startsWith('--')) {
      args[key] = 'true';
      continue;
    }

    args[key] = next;
    index += 1;
  }

  return args;
}

const args = parseArgs(process.argv.slice(2));
const rootDir = process.cwd();
const explicitSpecPath = String(args['spec-path'] || '').trim();
const specs = scanSpecFiles(rootDir, explicitSpecPath);
const anchor = specs[0] || null;
const remaining = anchor ? specs.slice(1) : [];

const payload = {
  count: specs.length,
  specs,
  anchor,
  remaining
};

if (process.env.GITHUB_OUTPUT) {
  appendGithubOutput('spec_matrix', JSON.stringify({ include: specs }));
  appendGithubOutput('remaining_spec_matrix', JSON.stringify({ include: remaining }));
  appendGithubOutput('anchor_spec_json', JSON.stringify(anchor || {}));
  appendGithubOutput('has_specs', specs.length > 0 ? 'true' : 'false');
  appendGithubOutput('spec_count', String(specs.length));
  appendGithubOutput('remaining_spec_count', String(remaining.length));
}

printJson(payload);
