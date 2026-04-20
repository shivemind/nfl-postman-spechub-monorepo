#!/usr/bin/env node

import { writeJsonFile } from './lib.mjs';

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
const outputPath = String(args.output || '').trim();

if (!outputPath) {
  throw new Error('--output is required');
}

const environmentUids = (() => {
  try {
    return JSON.parse(String(args['environment-uids-json'] || '{}'));
  } catch (error) {
    throw new Error(`Invalid --environment-uids-json value: ${error instanceof Error ? error.message : String(error)}`);
  }
})();

const payload = {
  specPath: String(args['spec-path'] || '').trim(),
  projectName: String(args['project-name'] || '').trim(),
  workspaceId: String(args['workspace-id'] || '').trim(),
  specId: String(args['spec-id'] || '').trim(),
  baselineCollectionId: String(args['baseline-collection-id'] || '').trim(),
  smokeCollectionId: String(args['smoke-collection-id'] || '').trim(),
  contractCollectionId: String(args['contract-collection-id'] || '').trim(),
  monitorId: String(args['monitor-id'] || '').trim(),
  mockUrl: String(args['mock-url'] || '').trim(),
  environmentUids,
  updatedAt: new Date().toISOString()
};

writeJsonFile(outputPath, payload);
