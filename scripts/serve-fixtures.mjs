import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixtureNames = new Set([
  'generic-form.html',
  'greenhouse-form.html',
  'greenhouse-iframe-parent.html',
  'lever-form.html',
  'ashby-form.html',
  'icims-form.html',
  'taleo-form.html',
  'smartrecruiters-form.html',
  'workday-form.html',
]);
const fixturePort = Number(process.env.FIXTURE_PORT ?? 4173);

if (!Number.isInteger(fixturePort) || fixturePort < 1 || fixturePort > 65535) {
  throw new Error('FIXTURE_PORT must be a valid TCP port.');
}

const server = createServer(async (request, response) => {
  let filename: string;
  try {
    filename = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname).replace(/^\/+/, '');
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }

  if (!fixtureNames.has(filename)) {
    response.writeHead(404).end('Fixture not found');
    return;
  }

  try {
    const body = await readFile(resolve(root, 'fixtures', filename));
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(500).end('Could not load fixture');
  }
});

server.listen(fixturePort, '127.0.0.1', () => {
  console.log(`Serving test fixtures at http://127.0.0.1:${fixturePort}/`);
  console.log(`Workday fixture: http://127.0.0.1:${fixturePort}/workday-form.html`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
