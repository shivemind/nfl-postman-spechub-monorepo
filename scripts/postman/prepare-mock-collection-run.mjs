#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { appendGithubOutput, normalizePosixPath, printJson } from './lib.mjs';

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

function normalizeCollectionApiId(value) {
  const normalized = String(value || '').trim();
  const uidMatch = normalized.match(/^[^-]+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return uidMatch ? uidMatch[1] : normalized;
}

function assertOutputPathWithinCwd(outputPathArg) {
  const outputPath = path.resolve(String(outputPathArg || '').trim());

  if (!outputPath) {
    throw new Error('--output-path is required');
  }

  const workspaceRoot = path.resolve(process.cwd());
  const relative = path.relative(workspaceRoot, outputPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Output path must stay within workspace: ${outputPathArg}`);
  }

  return outputPath;
}

async function fetchCollection(collectionId, postmanApiKey) {
  const normalizedCollectionId = normalizeCollectionApiId(collectionId);

  if (!normalizedCollectionId) {
    throw new Error('--collection-id is required');
  }
  if (!postmanApiKey) {
    throw new Error('--postman-api-key is required');
  }

  const response = await fetch(`https://api.getpostman.com/collections/${normalizedCollectionId}`, {
    headers: {
      'x-api-key': postmanApiKey
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch collection ${normalizedCollectionId}: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  if (!payload?.collection || typeof payload.collection !== 'object') {
    throw new Error(`Collection ${normalizedCollectionId} response did not include a collection payload`);
  }

  return payload.collection;
}

function firstSuccessfulResponseCode(item) {
  const responses = Array.isArray(item?.response) ? item.response : [];

  for (const response of responses) {
    const code = Number.parseInt(String(response?.code || ''), 10);
    if (Number.isInteger(code) && code >= 200 && code < 300) {
      return String(code);
    }
  }

  return '';
}

function upsertResponseCodeHeader(request, responseCode) {
  if (!request || typeof request !== 'object' || !responseCode) {
    return false;
  }

  const headers = Array.isArray(request.header) ? request.header : [];
  request.header = headers;

  const existingHeader = headers.find((header) => String(header?.key || '').trim().toLowerCase() === 'x-mock-response-code');
  if (existingHeader) {
    existingHeader.value = responseCode;
    return true;
  }

  headers.push({
    key: 'x-mock-response-code',
    value: responseCode,
    type: 'text'
  });
  return true;
}

function removeExcludedItems(items, excludeRegex) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const nextItems = [];
  let removedItemCount = 0;

  for (const item of normalizedItems) {
    const itemName = String(item?.name || '').trim();
    if (excludeRegex && excludeRegex.test(itemName)) {
      removedItemCount += 1;
      continue;
    }

    const nextItem = item && typeof item === 'object' ? { ...item } : item;
    if (nextItem && typeof nextItem === 'object' && Array.isArray(nextItem.item)) {
      const nested = removeExcludedItems(nextItem.item, excludeRegex);
      nextItem.item = nested.items;
      removedItemCount += nested.removedItemCount;
    }

    nextItems.push(nextItem);
  }

  return {
    items: nextItems,
    removedItemCount
  };
}

function applyMockResponseHeaders(items, trail = []) {
  const normalizedItems = Array.isArray(items) ? items : [];
  const patchedRequests = [];

  for (const item of normalizedItems) {
    const itemName = String(item?.name || '').trim();
    const nextTrail = itemName ? [...trail, itemName] : trail;

    if (item && typeof item === 'object' && item.request) {
      const responseCode = firstSuccessfulResponseCode(item);
      if (upsertResponseCodeHeader(item.request, responseCode)) {
        patchedRequests.push({
          path: nextTrail.join(' / '),
          responseCode
        });
      }
    }

    if (item && typeof item === 'object' && Array.isArray(item.item)) {
      patchedRequests.push(...applyMockResponseHeaders(item.item, nextTrail));
    }
  }

  return patchedRequests;
}

function stripResponseTimeAssertionLines(execLines) {
  const lines = Array.isArray(execLines) ? execLines : [];
  const nextLines = [];
  let removedAssertionCount = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || '');
    if (!line.includes('pm.test(\'Response time is acceptable\'')) {
      nextLines.push(line);
      continue;
    }

    removedAssertionCount += 1;

    while (index + 1 < lines.length) {
      index += 1;
      if (String(lines[index] || '').trim() === '});') {
        break;
      }
    }

    while (index + 1 < lines.length && String(lines[index + 1] || '').trim() === '') {
      index += 1;
    }
  }

  return {
    lines: nextLines,
    removedAssertionCount
  };
}

function stripResponseTimeAssertions(items) {
  const normalizedItems = Array.isArray(items) ? items : [];
  let removedAssertionCount = 0;

  for (const item of normalizedItems) {
    if (item && typeof item === 'object' && Array.isArray(item.event)) {
      for (const event of item.event) {
        if (String(event?.listen || '').trim() !== 'test') {
          continue;
        }

        const nextScript = stripResponseTimeAssertionLines(event?.script?.exec);
        event.script = {
          ...(event?.script && typeof event.script === 'object' ? event.script : {}),
          exec: nextScript.lines
        };
        removedAssertionCount += nextScript.removedAssertionCount;
      }
    }

    if (item && typeof item === 'object' && Array.isArray(item.item)) {
      removedAssertionCount += stripResponseTimeAssertions(item.item);
    }
  }

  return removedAssertionCount;
}

const args = parseArgs(process.argv.slice(2));
const postmanApiKey = String(args['postman-api-key'] || process.env.POSTMAN_API_KEY || '').trim();
const outputPath = assertOutputPathWithinCwd(args['output-path']);
const excludePattern = String(args['exclude-pattern'] || 'resolve secrets').trim();
const excludeRegex = excludePattern ? new RegExp(excludePattern, 'i') : null;

const collection = await fetchCollection(args['collection-id'], postmanApiKey);
const sanitizedCollection = JSON.parse(JSON.stringify(collection));
const filteredItems = removeExcludedItems(sanitizedCollection.item, excludeRegex);
sanitizedCollection.item = filteredItems.items;
const patchedRequests = applyMockResponseHeaders(sanitizedCollection.item);
const strippedResponseTimeAssertionCount = stripResponseTimeAssertions(sanitizedCollection.item);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(sanitizedCollection, null, 2)}\n`, 'utf8');

const result = {
  prepared_collection_path: normalizePosixPath(path.relative(process.cwd(), outputPath)),
  patched_request_count: String(patchedRequests.length),
  removed_item_count: String(filteredItems.removedItemCount),
  stripped_response_time_assertion_count: String(strippedResponseTimeAssertionCount),
  patched_requests_json: JSON.stringify(patchedRequests)
};

for (const [key, value] of Object.entries(result)) {
  appendGithubOutput(key, value);
}

if (!process.env.GITHUB_OUTPUT) {
  printJson(result);
}
