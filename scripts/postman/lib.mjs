import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SPEC_EXTENSIONS = new Set(['.json', '.yaml', '.yml']);

export function normalizePosixPath(value) {
  return String(value || '').trim().split(path.sep).join('/');
}

export function projectNameFromSpecPath(specPath) {
  const normalized = normalizePosixPath(specPath);
  const parsed = path.posix.parse(normalized);
  const parts = parsed.dir.split('/').filter(Boolean);
  const usefulParts = parts[0] === 'openapi' ? parts.slice(1) : parts;

  return [...usefulParts, parsed.name]
    .join('-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function walkSpecs(rootDir, currentDir, results) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      walkSpecs(rootDir, absolutePath, results);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    if (!SPEC_EXTENSIONS.has(extension)) {
      continue;
    }

    const relativePath = normalizePosixPath(path.relative(rootDir, absolutePath));
    results.push(relativePath);
  }
}

export function scanSpecFiles(rootDir, explicitSpecPath = '') {
  const normalizedExplicitPath = normalizePosixPath(explicitSpecPath);

  if (normalizedExplicitPath) {
    const absoluteSpecPath = path.join(rootDir, normalizedExplicitPath);
    if (!fs.existsSync(absoluteSpecPath)) {
      throw new Error(`Spec path does not exist: ${normalizedExplicitPath}`);
    }

    return [
      {
        specPath: normalizedExplicitPath,
        projectName: projectNameFromSpecPath(normalizedExplicitPath)
      }
    ];
  }

  const openApiRoot = path.join(rootDir, 'openapi');
  if (!fs.existsSync(openApiRoot)) {
    return [];
  }

  const discovered = [];
  walkSpecs(rootDir, openApiRoot, discovered);

  return discovered
    .sort((left, right) => left.localeCompare(right))
    .map((specPath) => ({
      specPath,
      projectName: projectNameFromSpecPath(specPath)
    }));
}

export function readJsonFile(filePath, fallbackValue = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallbackValue;
  }
}

export function computeFileSha256(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch {
    return '';
  }
}

export function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function readManifest(manifestPath) {
  const manifest = readJsonFile(manifestPath, {
    workspaceId: '',
    specs: {}
  });

  return {
    workspaceId: String(manifest?.workspaceId || '').trim(),
    updatedAt: String(manifest?.updatedAt || '').trim(),
    specs:
      manifest && typeof manifest === 'object' && manifest.specs && typeof manifest.specs === 'object'
        ? manifest.specs
        : {}
  };
}

export function appendGithubOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }

  const delimiter = `EOF_${name.toUpperCase()}_${Date.now()}`;
  fs.appendFileSync(outputPath, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

export function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, sortObject(nestedValue)])
  );
}

export function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}
