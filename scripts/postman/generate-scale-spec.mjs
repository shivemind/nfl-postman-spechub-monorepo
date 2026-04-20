#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

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

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildSpecYaml(operationCount) {
  const lines = [
    'openapi: 3.0.3',
    'info:',
    '  title: NFL Spec Scale Test API',
    '  version: 1.0.0',
    '  description: Synthetic NFL scale-test API used to validate large Spec Hub onboarding scenarios.',
    'servers:',
    '  - url: https://stage-api.nfl.example.com/spec-scale',
    '    description: Stage',
    '  - url: https://api.nfl.example.com/spec-scale',
    '    description: Production',
    'tags:',
    '  - name: ScaleResources',
    'security:',
    '  - bearerAuth: []',
    'paths:'
  ];

  for (let index = 1; index <= operationCount; index += 1) {
    const suffix = String(index).padStart(3, '0');
    const slug = `resource-${suffix}`;
    const resourceName = `scale-${suffix}`;

    lines.push(`  /scale/v1/${slug}:`);
    lines.push('    get:');
    lines.push(`      operationId: getScaleResource${suffix}`);
    lines.push(`      summary: Retrieve scale-test payload ${suffix}`);
    lines.push('      tags: [ScaleResources]');
    lines.push('      parameters:');
    lines.push('        - $ref: "#/components/parameters/IncludeMetadata"');
    lines.push('        - name: traceId');
    lines.push('          in: header');
    lines.push('          required: false');
    lines.push('          schema:');
    lines.push('            type: string');
    lines.push('      responses:');
    lines.push('        "200":');
    lines.push(`          description: Successful lookup for ${resourceName}`);
    lines.push('          content:');
    lines.push('            application/json:');
    lines.push('              schema:');
    lines.push('                $ref: "#/components/schemas/ScaleResourceResponse"');
    lines.push('              examples:');
    lines.push('                default:');
    lines.push('                  value:');
    lines.push(`                    resourceId: "${resourceName}"`);
    lines.push(`                    displayName: "NFL Scale Resource ${suffix}"`);
    lines.push('                    status: active');
    lines.push('                    includeMetadata: true');
    lines.push('                    metadata:');
    lines.push(`                      partition: "scale-${Math.ceil(index / 25)}"`);
    lines.push(`                      ordinal: ${index}`);
    lines.push('        "400":');
    lines.push('          $ref: "#/components/responses/BadRequest"');
    lines.push('        "429":');
    lines.push('          $ref: "#/components/responses/TooManyRequests"');
    lines.push('        "500":');
    lines.push('          $ref: "#/components/responses/InternalError"');
  }

  lines.push('components:');
  lines.push('  parameters:');
  lines.push('    IncludeMetadata:');
  lines.push('      name: includeMetadata');
  lines.push('      in: query');
  lines.push('      required: false');
  lines.push('      schema:');
  lines.push('        type: boolean');
  lines.push('        default: true');
  lines.push('  schemas:');
  lines.push('    ScaleResourceResponse:');
  lines.push('      type: object');
  lines.push('      required: [resourceId, displayName, status, includeMetadata]');
  lines.push('      properties:');
  lines.push('        resourceId:');
  lines.push('          type: string');
  lines.push('        displayName:');
  lines.push('          type: string');
  lines.push('        status:');
  lines.push('          type: string');
  lines.push('          enum: [active, inactive, deprecated]');
  lines.push('        includeMetadata:');
  lines.push('          type: boolean');
  lines.push('        metadata:');
  lines.push('          $ref: "#/components/schemas/ScaleMetadata"');
  lines.push('    ScaleMetadata:');
  lines.push('      type: object');
  lines.push('      properties:');
  lines.push('        partition:');
  lines.push('          type: string');
  lines.push('        ordinal:');
  lines.push('          type: integer');
  lines.push('        generatedBy:');
  lines.push('          type: string');
  lines.push('          example: scripts/postman/generate-scale-spec.mjs');
  lines.push('    ErrorResponse:');
  lines.push('      type: object');
  lines.push('      properties:');
  lines.push('        error:');
  lines.push('          type: string');
  lines.push('        message:');
  lines.push('          type: string');
  lines.push('        statusCode:');
  lines.push('          type: integer');
  lines.push('  responses:');
  lines.push('    BadRequest:');
  lines.push('      description: Invalid request parameters');
  lines.push('      content:');
  lines.push('        application/json:');
  lines.push('          schema:');
  lines.push('            $ref: "#/components/schemas/ErrorResponse"');
  lines.push('    TooManyRequests:');
  lines.push('      description: Rate limit exceeded');
  lines.push('      content:');
  lines.push('        application/json:');
  lines.push('          schema:');
  lines.push('            $ref: "#/components/schemas/ErrorResponse"');
  lines.push('    InternalError:');
  lines.push('      description: Internal platform error');
  lines.push('      content:');
  lines.push('        application/json:');
  lines.push('          schema:');
  lines.push('            $ref: "#/components/schemas/ErrorResponse"');
  lines.push('  securitySchemes:');
  lines.push('    bearerAuth:');
  lines.push('      type: http');
  lines.push('      scheme: bearer');
  lines.push('      bearerFormat: JWT');

  return `${lines.join('\n')}\n`;
}

const args = parseArgs(process.argv.slice(2));
const operationCount = toPositiveInteger(args.operations, 250);
const outputPath = String(args.output || 'openapi/platform/spec-scale-test-api.yaml').trim();

if (!outputPath) {
  throw new Error('--output is required');
}

const yaml = buildSpecYaml(operationCount);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, yaml);

process.stdout.write(
  `${JSON.stringify({ outputPath, operationCount, bytes: Buffer.byteLength(yaml, 'utf8') }, null, 2)}\n`
);
