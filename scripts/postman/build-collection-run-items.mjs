#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { appendGithubOutput, printJson } from './lib.mjs';

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

function itemNameFromRef(refValue) {
  const normalized = String(refValue || '').trim().replace(/^['"]|['"]$/g, '').replace(/^\.\//, '');
  if (!normalized) {
    return '';
  }

  if (normalized.endsWith('/folder.yaml')) {
    return path.posix.basename(path.posix.dirname(normalized));
  }

  if (normalized.endsWith('.request.yaml')) {
    return path.posix.basename(normalized, '.request.yaml');
  }

  return path.posix.basename(normalized, path.posix.extname(normalized));
}

function normalizeCollectionApiId(value) {
  const normalized = String(value || '').trim();
  const uidMatch = normalized.match(/^[^-]+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return uidMatch ? uidMatch[1] : normalized;
}

function collectTopLevelItemMetadataFromFile(collectionPath, excludeRegex) {
  const contents = fs.readFileSync(collectionPath, 'utf8');
  return Array.from(contents.matchAll(/^\s*-\s*ref:\s*(.+)\s*$/gm))
    .map((match) => itemNameFromRef(match[1]))
    .filter(Boolean)
    .filter((name, index, values) => values.indexOf(name) === index)
    .filter((name) => !excludeRegex || !excludeRegex.test(name))
    .map((name) => ({ name, identifier: name, source: 'name' }));
}

async function collectTopLevelItemMetadataFromApi(collectionId, postmanApiKey, excludeRegex) {
  const collectionApiId = normalizeCollectionApiId(collectionId);
  const response = await fetch(`https://api.getpostman.com/collections/${collectionApiId}`, {
    headers: {
      'x-api-key': postmanApiKey
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch collection ${collectionApiId}: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const items = Array.isArray(payload?.collection?.item) ? payload.collection.item : [];

  return items
    .map((item) => ({
      name: String(item?.name || '').trim(),
      identifier: String(item?.uid || item?.id || '').trim(),
      source: item?.uid ? 'uid' : item?.id ? 'id' : ''
    }))
    .filter((item) => item.name && item.identifier)
    .filter((item, index, values) => values.findIndex((candidate) => candidate.identifier === item.identifier) === index)
    .filter((item) => !excludeRegex || !excludeRegex.test(item.name));
}

const args = parseArgs(process.argv.slice(2));
const collectionPath = String(args['collection-path'] || '').trim();
const collectionId = String(args['collection-id'] || '').trim();
const postmanApiKey = String(args['postman-api-key'] || process.env.POSTMAN_API_KEY || '').trim();
const excludePattern = String(args['exclude-pattern'] || 'resolve secrets').trim();
const excludeRegex = excludePattern ? new RegExp(excludePattern, 'i') : null;

if (!collectionPath && !collectionId) {
  throw new Error('--collection-path or --collection-id is required');
}
if (collectionId && !postmanApiKey) {
  throw new Error('--postman-api-key is required when --collection-id is provided');
}

const items = collectionId
  ? await collectTopLevelItemMetadataFromApi(collectionId, postmanApiKey, excludeRegex)
  : collectTopLevelItemMetadataFromFile(collectionPath, excludeRegex);

const itemNames = items.map((item) => item.name);
const itemIdentifiers = items.map((item) => item.identifier);

const invalidIdentifier = itemIdentifiers.find((identifier) => /\s/.test(identifier));
if (invalidIdentifier) {
  throw new Error(`Collection run identifier must not contain whitespace: ${invalidIdentifier}`);
}

const includeArgs = itemIdentifiers.map((identifier) => `-i ${identifier}`).join(' ');
const result = {
  include_args: includeArgs,
  item_count: String(itemNames.length),
  item_names_json: JSON.stringify(itemNames),
  item_identifiers_json: JSON.stringify(itemIdentifiers)
};

for (const [key, value] of Object.entries(result)) {
  appendGithubOutput(key, value);
}

if (!process.env.GITHUB_OUTPUT) {
  printJson(result);
}
