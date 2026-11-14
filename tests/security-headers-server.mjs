import { createServer } from 'node:http';
// Local HTTP harness for security-headers.browser.js; never used for deployment.
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
const root = resolve('dist');
const headers = JSON.parse(await readFile('.local/security-headers/headers.json', 'utf8'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
for (const port of [4188, 4189]) {
  createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/tests/helpers/catalog-fixture.js') {
      response.writeHead(200, { ...headers, 'content-type': 'text/javascript' });
      response.end(await readFile('tests/helpers/catalog-fixture.js'));
      return;
    }
    if (url.pathname === '/embed-test.html') {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end('<!doctype html><title>Frame test</title><iframe src="http://127.0.0.1:4188/"></iframe>');
      return;
    }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + sep)) { response.writeHead(403); response.end(); return; }
    try {
      const body = await readFile(path);
      response.writeHead(200, { ...headers, 'content-type': types[extname(path)] || 'application/octet-stream' });
      response.end(body);
    } catch { response.writeHead(404, headers); response.end(); }
  }).listen(port, '127.0.0.1', () => console.log(`Security header test: http://127.0.0.1:${port}`));
}
