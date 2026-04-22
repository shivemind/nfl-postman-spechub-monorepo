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

function shellQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\"'\"'`)}'`;
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

const args = parseArgs(process.argv.slice(2));
const collectionPath = String(args['collection-path'] || '').trim();
if (!collectionPath) {
  throw new Error('--collection-path is required');
}

const excludePattern = String(args['exclude-pattern'] || 'resolve secrets').trim();
const excludeRegex = excludePattern ? new RegExp(excludePattern, 'i') : null;
const contents = fs.readFileSync(collectionPath, 'utf8');
const itemNames = Array.from(contents.matchAll(/^\s*-\s*ref:\s*(.+)\s*$/gm))
  .map((match) => itemNameFromRef(match[1]))
  .filter(Boolean)
  .filter((name, index, values) => values.indexOf(name) === index)
  .filter((name) => !excludeRegex || !excludeRegex.test(name));

const includeArgs = itemNames.map((name) => `-i ${shellQuote(name)}`).join(' ');
const result = {
  include_args: includeArgs,
  item_count: String(itemNames.length),
  item_names_json: JSON.stringify(itemNames)
};

for (const [key, value] of Object.entries(result)) {
  appendGithubOutput(key, value);
}

if (!process.env.GITHUB_OUTPUT) {
  printJson(result);
}
