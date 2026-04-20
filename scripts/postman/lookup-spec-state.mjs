#!/usr/bin/env node

import { appendGithubOutput, normalizePosixPath, printJson, readManifest } from './lib.mjs';

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
const manifestPath = String(args.manifest || '.postman/spec-hub-manifest.json');
const specPath = normalizePosixPath(args['spec-path'] || '');
const manifest = readManifest(manifestPath);
const entry = manifest.specs?.[specPath] || {};

const payload = {
  workspaceId: String(entry.workspaceId || manifest.workspaceId || '').trim(),
  specId: String(entry.specId || '').trim(),
  baselineCollectionId: String(entry.baselineCollectionId || '').trim(),
  smokeCollectionId: String(entry.smokeCollectionId || '').trim(),
  contractCollectionId: String(entry.contractCollectionId || '').trim(),
  monitorId: String(entry.monitorId || '').trim(),
  mockUrl: String(entry.mockUrl || '').trim(),
  specSha256: String(entry.specSha256 || '').trim(),
  environmentUids: entry.environmentUids && typeof entry.environmentUids === 'object' ? entry.environmentUids : {},
  projectName: String(entry.projectName || '').trim()
};

if (process.env.GITHUB_OUTPUT) {
  appendGithubOutput('workspace_id', payload.workspaceId);
  appendGithubOutput('spec_id', payload.specId);
  appendGithubOutput('baseline_collection_id', payload.baselineCollectionId);
  appendGithubOutput('smoke_collection_id', payload.smokeCollectionId);
  appendGithubOutput('contract_collection_id', payload.contractCollectionId);
  appendGithubOutput('monitor_id', payload.monitorId);
  appendGithubOutput('mock_url', payload.mockUrl);
  appendGithubOutput('spec_sha256', payload.specSha256);
  appendGithubOutput('project_name', payload.projectName);
  appendGithubOutput('environment_uids_json', JSON.stringify(payload.environmentUids));
}

printJson(payload);
