#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { normalizePosixPath, projectNameFromSpecPath, readManifest, scanSpecFiles } from './lib.mjs';

const COLLECTION_TYPES = [
  ['baselineCollectionId', 'Baseline'],
  ['smokeCollectionId', 'Smoke'],
  ['contractCollectionId', 'Contract']
];

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

function ensureDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function yamlScalar(value) {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value === null) {
    return 'null';
  }

  throw new Error(`Unsupported YAML scalar type: ${typeof value}`);
}

function yamlKey(value) {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : JSON.stringify(value);
}

function appendYaml(lines, value, indentLevel, key = null) {
  const indent = '  '.repeat(indentLevel);
  const serializedKey = key === null ? null : yamlKey(key);

  if (Array.isArray(value)) {
    if (key !== null) {
      if (value.length === 0) {
        lines.push(`${indent}${serializedKey}: []`);
        return;
      }

      lines.push(`${indent}${serializedKey}:`);
    }

    for (const item of value) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        lines.push(`${indent}${key === null ? '' : '  '}-`);
        appendYaml(lines, item, indentLevel + (key === null ? 1 : 2));
        continue;
      }

      lines.push(`${indent}${key === null ? '' : '  '}- ${yamlScalar(item)}`);
    }

    return;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value);

    if (key !== null) {
      if (entries.length === 0) {
        lines.push(`${indent}${serializedKey}: {}`);
        return;
      }

      lines.push(`${indent}${serializedKey}:`);
    }

    const childIndentLevel = key === null ? indentLevel : indentLevel + 1;
    for (const [childKey, childValue] of entries) {
      appendYaml(lines, childValue, childIndentLevel, childKey);
    }

    return;
  }

  if (key === null) {
    lines.push(`${indent}${yamlScalar(value)}`);
    return;
  }

  lines.push(`${indent}${serializedKey}: ${yamlScalar(value)}`);
}

function dumpYaml(value) {
  const lines = [];
  appendYaml(lines, value, 0);
  return `${lines.join('\n')}\n`;
}

function assertSingleWorkspace(manifest) {
  const workspaceIds = new Set();

  if (manifest.workspaceId) {
    workspaceIds.add(manifest.workspaceId);
  }

  for (const state of Object.values(manifest.specs || {})) {
    const workspaceId = String(state?.workspaceId || '').trim();
    if (workspaceId) {
      workspaceIds.add(workspaceId);
    }
  }

  if (workspaceIds.size > 1) {
    throw new Error(`Expected one shared workspace, found multiple IDs: ${Array.from(workspaceIds).join(', ')}`);
  }

  return Array.from(workspaceIds)[0] || '';
}

function assertUniqueProjectNames(manifest) {
  const seen = new Map();

  for (const [specPath, state] of Object.entries(manifest.specs || {})) {
    const projectName = String(state?.projectName || projectNameFromSpecPath(specPath)).trim();
    if (!projectName) {
      continue;
    }

    const existing = seen.get(projectName);
    if (existing && existing !== specPath) {
      throw new Error(`Project name collision detected for "${projectName}": ${existing} and ${specPath}`);
    }

    seen.set(projectName, specPath);
  }
}

function buildCollectionRef(projectName, label) {
  return `../postman/${projectName}/collections/[${label}] ${projectName}`;
}

function buildEnvironmentRef(projectName, envName) {
  return `../postman/${projectName}/environments/${envName}.postman_environment.json`;
}

function buildSpecRef(specPath) {
  return `../${normalizePosixPath(specPath)}`;
}

function verifyPathExists(targetPath, expectedType, skipPathChecks) {
  if (skipPathChecks) {
    return;
  }

  if (!fs.existsSync(targetPath)) {
    throw new Error(`Expected ${expectedType} to exist: ${normalizePosixPath(targetPath)}`);
  }

  const stats = fs.statSync(targetPath);
  if (expectedType === 'directory' && !stats.isDirectory()) {
    throw new Error(`Expected directory but found something else: ${normalizePosixPath(targetPath)}`);
  }
  if (expectedType === 'file' && !stats.isFile()) {
    throw new Error(`Expected file but found something else: ${normalizePosixPath(targetPath)}`);
  }
}

const args = parseArgs(process.argv.slice(2));
const manifestPath = String(args.manifest || '.postman/spec-hub-manifest.json').trim();
const skipPathChecks = String(args['skip-path-checks'] || '').trim() === 'true';

const manifest = readManifest(manifestPath);
const workspaceId = assertSingleWorkspace(manifest);
assertUniqueProjectNames(manifest);

const discoveredSpecs = scanSpecFiles(process.cwd());
const localSpecRefs = discoveredSpecs.map(({ specPath }) => buildSpecRef(specPath));

const localCollections = [];
const localEnvironments = [];
const cloudCollections = {};
const cloudEnvironments = {};
const cloudSpecs = {};
const workflowLinks = [];

for (const { specPath } of discoveredSpecs) {
  const state = manifest.specs?.[specPath];
  if (!state || typeof state !== 'object') {
    continue;
  }

  const projectName = String(state.projectName || projectNameFromSpecPath(specPath)).trim();
  if (!projectName) {
    continue;
  }

  const specRef = buildSpecRef(specPath);
  const collectionRefs = [];

  for (const [idKey, label] of COLLECTION_TYPES) {
    const collectionId = String(state[idKey] || '').trim();
    if (!collectionId) {
      continue;
    }

    const ref = buildCollectionRef(projectName, label);
    const directoryPath = path.join(process.cwd(), 'postman', projectName, 'collections', `[${label}] ${projectName}`);
    verifyPathExists(directoryPath, 'directory', skipPathChecks);

    localCollections.push(ref);
    cloudCollections[ref] = collectionId;
    collectionRefs.push(ref);
  }

  const environmentEntries =
    state.environmentUids && typeof state.environmentUids === 'object'
      ? Object.entries(state.environmentUids)
      : [];

  for (const [envName, envUidValue] of environmentEntries.sort(([left], [right]) => left.localeCompare(right))) {
    const envUid = String(envUidValue || '').trim();
    if (!envUid) {
      continue;
    }

    const ref = buildEnvironmentRef(projectName, envName);
    const filePath = path.join(process.cwd(), 'postman', projectName, 'environments', `${envName}.postman_environment.json`);
    verifyPathExists(filePath, 'file', skipPathChecks);

    localEnvironments.push(ref);
    cloudEnvironments[ref] = envUid;
  }

  const specId = String(state.specId || '').trim();
  if (specId) {
    cloudSpecs[specRef] = specId;
  }

  for (const collectionRef of collectionRefs) {
    workflowLinks.push({
      spec: specRef,
      collection: collectionRef
    });
  }
}

const resources = {
  workspace: {
    id: workspaceId
  }
};

const localResources = {};
if (localCollections.length > 0) {
  localResources.collections = localCollections;
}
if (localEnvironments.length > 0) {
  localResources.environments = localEnvironments;
}
if (localSpecRefs.length > 0) {
  localResources.specs = localSpecRefs;
}
if (Object.keys(localResources).length > 0) {
  resources.localResources = localResources;
}

const cloudResources = {};
if (Object.keys(cloudCollections).length > 0) {
  cloudResources.collections = cloudCollections;
}
if (Object.keys(cloudEnvironments).length > 0) {
  cloudResources.environments = cloudEnvironments;
}
if (Object.keys(cloudSpecs).length > 0) {
  cloudResources.specs = cloudSpecs;
}
if (Object.keys(cloudResources).length > 0) {
  resources.cloudResources = cloudResources;
}

ensureDirectory('.postman/resources.yaml');
fs.writeFileSync('.postman/resources.yaml', dumpYaml(resources));

const workflowsPath = '.postman/workflows.yaml';
if (workflowLinks.length > 0) {
  ensureDirectory(workflowsPath);
  fs.writeFileSync(
    workflowsPath,
    dumpYaml({
      workflows: {
        syncSpecToCollection: workflowLinks
      }
    })
  );
} else if (fs.existsSync(workflowsPath)) {
  fs.rmSync(workflowsPath);
}
