#!/usr/bin/env node

import fs from 'node:fs';
import https from 'node:https';
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

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(String(args.root || process.cwd()));
const host = String(args.host || '127.0.0.1').trim();
const port = Number(args.port || 8123);
const keyPath = String(args.key || '').trim();
const certPath = String(args.cert || '').trim();

if (!Number.isInteger(port) || port <= 0) {
  throw new Error('--port must be a positive integer');
}

if (!keyPath) {
  throw new Error('--key is required');
}

if (!certPath) {
  throw new Error('--cert is required');
}

const contentTypes = new Map([
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.yaml', 'application/yaml; charset=utf-8'],
  ['.yml', 'application/yaml; charset=utf-8']
]);

const server = https.createServer(
  {
    key: fs.readFileSync(keyPath, 'utf8'),
    cert: fs.readFileSync(certPath, 'utf8')
  },
  (request, response) => {
    try {
      const requestUrl = new URL(request.url || '/', `https://${host}`);
      const pathname = decodeURIComponent(requestUrl.pathname);
      const candidate = path.resolve(root, `.${pathname}`);

      if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('forbidden');
        return;
      }

      let target = candidate;
      let stat;
      try {
        stat = fs.statSync(target);
      } catch {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('not found');
        return;
      }

      if (stat.isDirectory()) {
        target = path.join(target, 'README.md');
        stat = fs.statSync(target);
      }

      response.writeHead(200, {
        'Content-Length': String(stat.size),
        'Content-Type': contentTypes.get(path.extname(target)) || 'application/octet-stream'
      });
      fs.createReadStream(target).pipe(response);
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : String(error));
    }
  }
);

server.listen(port, host, () => {
  process.stdout.write(`listening on https://${host}:${port}\n`);
});
