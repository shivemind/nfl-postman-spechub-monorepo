#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  appendGithubOutput,
  computeFileSha256,
  projectNameFromSpecPath,
  readJsonFile,
  readManifest,
  scanSpecFiles,
  sortObject,
  writeJsonFile
} from './lib.mjs';

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
const manifestPath = String(args.manifest || '.postman/spec-hub-manifest.json').trim();
const statesDir = String(args['states-dir'] || '').trim();
const stateOnly = String(args['state-only'] || '').trim() === 'true';

if (!statesDir) {
  throw new Error('--states-dir is required');
}

const manifest = readManifest(manifestPath);
const stateFiles = fs.existsSync(statesDir)
  ? fs.readdirSync(statesDir).filter((fileName) => fileName.endsWith('.json'))
  : [];

const stateBySpecPath = new Map();
for (const fileName of stateFiles) {
  const state = readJsonFile(path.join(statesDir, fileName), {});
  const specPath = String(state?.specPath || '').trim();
  if (!specPath) {
    continue;
  }

  stateBySpecPath.set(specPath, state);
}

const currentSpecs = (() => {
  if (!stateOnly) {
    return scanSpecFiles(process.cwd());
  }

  const specsByPath = new Map();

  for (const [specPath, entry] of Object.entries(manifest.specs || {})) {
    specsByPath.set(specPath, {
      specPath,
      projectName: String(entry?.projectName || projectNameFromSpecPath(specPath)).trim()
    });
  }

  for (const [specPath, entry] of stateBySpecPath.entries()) {
    specsByPath.set(specPath, {
      specPath,
      projectName: String(entry?.projectName || projectNameFromSpecPath(specPath)).trim()
    });
  }

  return Array.from(specsByPath.values()).sort((left, right) => left.specPath.localeCompare(right.specPath));
})();

const specs = {};
let workspaceId = manifest.workspaceId;

for (const spec of currentSpecs) {
  const state = stateBySpecPath.get(spec.specPath) || manifest.specs?.[spec.specPath] || {};
  const resolvedWorkspaceId = String(state.workspaceId || workspaceId || '').trim();

  if (resolvedWorkspaceId && !workspaceId) {
    workspaceId = resolvedWorkspaceId;
  }

  specs[spec.specPath] = {
    projectName: String(state.projectName || spec.projectName || projectNameFromSpecPath(spec.specPath)).trim(),
    specSha256: String(state.specSha256 || computeFileSha256(spec.specPath) || '').trim(),
    workspaceId: resolvedWorkspaceId,
    specId: String(state.specId || '').trim(),
    baselineCollectionId: String(state.baselineCollectionId || '').trim(),
    smokeCollectionId: String(state.smokeCollectionId || '').trim(),
    contractCollectionId: String(state.contractCollectionId || '').trim(),
    monitorId: String(state.monitorId || '').trim(),
    mockUrl: String(state.mockUrl || '').trim(),
    environmentUids:
      state.environmentUids && typeof state.environmentUids === 'object' ? sortObject(state.environmentUids) : {}
  };
}

const previousStableState = JSON.stringify(
  sortObject({
    workspaceId: manifest.workspaceId,
    specs: manifest.specs
  })
);

const nextStableState = JSON.stringify(
  sortObject({
    workspaceId,
    specs
  })
);

const mergedManifest = sortObject({
  workspaceId,
  updatedAt: previousStableState === nextStableState ? manifest.updatedAt : new Date().toISOString(),
  specs
});

writeJsonFile(manifestPath, mergedManifest);

if (process.env.GITHUB_OUTPUT) {
  appendGithubOutput('workspace_id', workspaceId);
  appendGithubOutput('spec_count', String(currentSpecs.length));
}
