#!/usr/bin/env node

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

function normalizeName(value) {
  return String(value || '').trim().toLowerCase();
}

function canonicalEnvironmentName(value) {
  const normalized = normalizeName(value);

  if (normalized === 'production' || normalized === 'prod') {
    return 'prod';
  }

  if (normalized === 'staging' || normalized === 'stage') {
    return 'stage';
  }

  return normalized;
}

function environmentAliases(value) {
  const normalized = normalizeName(value);
  const canonical = canonicalEnvironmentName(normalized);

  if (canonical === 'prod') {
    return ['prod', 'production'];
  }

  if (canonical === 'stage') {
    return ['stage', 'staging'];
  }

  return normalized ? [normalized] : [];
}

function parseJsonInput(label, value, fallbackValue) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return fallbackValue;
  }

  try {
    const parsed = JSON.parse(normalized);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }

  return fallbackValue;
}

function selectEnvironment(environmentUids, preferredEnvironmentNames, runtimeUrls) {
  const environmentEntries = Object.entries(environmentUids)
    .map(([name, uid]) => [String(name || '').trim(), String(uid || '').trim()])
    .filter(([name, uid]) => name && uid);

  const pickMatch = (requireConfiguredRuntimeUrl) => {
    for (const preferredName of preferredEnvironmentNames) {
      const preferredNormalized = normalizeName(preferredName);
      const preferredCanonical = canonicalEnvironmentName(preferredName);
      const match = environmentEntries.find(([name]) => {
        const normalized = normalizeName(name);
        return normalized === preferredNormalized || canonicalEnvironmentName(name) === preferredCanonical;
      });

      if (!match) {
        continue;
      }

      if (requireConfiguredRuntimeUrl && !resolveConfiguredRuntimeUrl(runtimeUrls, match[0])) {
        continue;
      }

      return {
        environmentName: match[0],
        environmentUid: match[1]
      };
    }

    return null;
  };

  const runtimeAwareMatch = pickMatch(true);
  if (runtimeAwareMatch) {
    return runtimeAwareMatch;
  }

  const preferredMatch = pickMatch(false);
  if (preferredMatch) {
    return preferredMatch;
  }

  const [environmentName = '', environmentUid = ''] = environmentEntries[0] || [];
  return {
    environmentName,
    environmentUid
  };
}

function resolveConfiguredRuntimeUrl(runtimeUrls, environmentName) {
  return resolveEnvironmentMappedValue(runtimeUrls, environmentName);
}

function resolveEnvironmentMappedValue(values, environmentName) {
  const entries = Object.entries(values)
    .map(([name, value]) => [String(name || '').trim(), String(value || '').trim()])
    .filter(([name, value]) => name && value);

  const aliases = environmentAliases(environmentName);
  if (aliases.length === 0) {
    return '';
  }

  for (const alias of aliases) {
    const match = entries.find(([name]) => normalizeName(name) === alias || canonicalEnvironmentName(name) === alias);
    if (match) {
      return match[1];
    }
  }

  return '';
}

const args = parseArgs(process.argv.slice(2));
const environmentUids = parseJsonInput('environment_uids_json', args['environment-uids-json'], {});
const runtimeUrls = parseJsonInput('env_runtime_urls_json', args['env-runtime-urls-json'], {});
const systemEnvMap = parseJsonInput('system_env_map_json', args['system-env-map-json'], {});
const preferredEnvironmentNames = String(args['preferred-environments'] || 'prod,production,stage,staging')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const mockUrl = String(args['mock-url'] || '').trim();

const { environmentName, environmentUid } = selectEnvironment(environmentUids, preferredEnvironmentNames, runtimeUrls);
const configuredRuntimeUrl = resolveConfiguredRuntimeUrl(runtimeUrls, environmentName);
const systemEnvironmentId = resolveEnvironmentMappedValue(systemEnvMap, environmentName);
const runtimeUrl = configuredRuntimeUrl || mockUrl;
const runtimeSource = configuredRuntimeUrl ? 'configured' : runtimeUrl ? 'mock' : '';
const ciOverride = runtimeSource === 'mock' ? 'true' : '';
const canRun = environmentUid && runtimeUrl ? 'true' : 'false';
const skipReason = canRun === 'true' ? '' : environmentUid ? 'runtime-url-unavailable' : 'environment-unavailable';

const result = {
  environment_name: environmentName,
  environment_uid: environmentUid,
  system_environment_id: systemEnvironmentId,
  runtime_url: runtimeUrl,
  runtime_source: runtimeSource,
  ci_override: ciOverride,
  can_run: canRun,
  skip_reason: skipReason
};

for (const [key, value] of Object.entries(result)) {
  appendGithubOutput(key, value);
}

if (!process.env.GITHUB_OUTPUT) {
  printJson(result);
}
