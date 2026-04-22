#!/usr/bin/env node

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

const args = parseArgs(process.argv.slice(2));
const repository = String(args.repository || process.env.GITHUB_REPOSITORY || '').trim();
const sha = String(args.sha || process.env.GITHUB_SHA || '').trim();
const specPath = normalizePosixPath(args['spec-path'] || '');
const localSpecBaseUrl = String(args['local-spec-base-url'] || process.env.LOCAL_SPEC_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '');

if (!specPath) {
  throw new Error('--spec-path is required');
}

const encodedPath = specPath
  .split('/')
  .map((segment) => encodeURIComponent(segment))
  .join('/');

if (!localSpecBaseUrl) {
  if (!repository) {
    throw new Error('Missing GitHub repository context');
  }

  if (!sha) {
    throw new Error('Missing GitHub SHA context');
  }
}

const specUrl = localSpecBaseUrl
  ? `${localSpecBaseUrl}/${encodedPath}`
  : `https://raw.githubusercontent.com/${repository}/${sha}/${encodedPath}`;

if (process.env.GITHUB_OUTPUT) {
  appendGithubOutput('spec_url', specUrl);
}

printJson({ specUrl });
