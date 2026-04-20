#!/usr/bin/env node

import { appendGithubOutput, readManifest, scanSpecFiles } from './lib.mjs';

function parseEnvironmentId(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  if (/^\d+-[0-9a-f]{8}-/i.test(normalized)) {
    return normalized.replace(/^\d+-/, '');
  }

  return normalized;
}

function parseMockId(mockUrl) {
  const normalized = String(mockUrl || '').trim();
  if (!normalized) {
    return '';
  }

  try {
    const url = new URL(normalized);
    const host = url.hostname.split('.')[0];
    return host || '';
  } catch {
    return '';
  }
}

async function deleteResource(apiKey, resourcePath) {
  const response = await fetch(`https://api.getpostman.com${resourcePath}`, {
    method: 'DELETE',
    headers: {
      'X-API-Key': apiKey
    }
  });

  if (response.ok || response.status === 404) {
    return;
  }

  const body = await response.text();
  throw new Error(`DELETE ${resourcePath} failed with ${response.status}: ${body}`);
}

const manifestPath = process.argv[2] || '.postman/spec-hub-manifest.json';
const manifest = readManifest(manifestPath);
const currentSpecs = new Set(scanSpecFiles(process.cwd()).map((entry) => entry.specPath));
const removedEntries = Object.entries(manifest.specs || {}).filter(([specPath]) => !currentSpecs.has(specPath));
const apiKey = String(process.env.POSTMAN_API_KEY || '').trim();

if (removedEntries.length === 0) {
  if (process.env.GITHUB_OUTPUT) {
    appendGithubOutput('removed_spec_count', '0');
  }
  process.stdout.write('No removed specs detected.\n');
  process.exit(0);
}

if (!apiKey) {
  throw new Error('POSTMAN_API_KEY is required to delete removed Postman assets');
}

for (const [specPath, entry] of removedEntries) {
  process.stdout.write(`Cleaning up removed spec assets for ${specPath}\n`);

  const monitorId = String(entry?.monitorId || '').trim();
  if (monitorId) {
    await deleteResource(apiKey, `/monitors/${monitorId}`);
  }

  const mockId = parseMockId(entry?.mockUrl);
  if (mockId) {
    await deleteResource(apiKey, `/mocks/${mockId}`);
  }

  for (const collectionId of [
    entry?.baselineCollectionId,
    entry?.smokeCollectionId,
    entry?.contractCollectionId
  ]) {
    const normalized = String(collectionId || '').trim();
    if (normalized) {
      await deleteResource(apiKey, `/collections/${normalized}`);
    }
  }

  for (const environmentUid of Object.values(entry?.environmentUids || {})) {
    const environmentId = parseEnvironmentId(environmentUid);
    if (environmentId) {
      await deleteResource(apiKey, `/environments/${environmentId}`);
    }
  }

  const specId = String(entry?.specId || '').trim();
  if (specId) {
    await deleteResource(apiKey, `/specs/${specId}`);
  }
}

if (process.env.GITHUB_OUTPUT) {
  appendGithubOutput('removed_spec_count', String(removedEntries.length));
}
