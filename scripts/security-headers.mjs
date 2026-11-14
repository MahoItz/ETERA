import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnv } from 'vite';

export function securityHeaders(html, supabaseUrl) {
  const endpoint = new URL(supabaseUrl);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password ||
      endpoint.pathname !== '/' || endpoint.search || endpoint.hash) {
    throw new Error('VITE_SUPABASE_URL must be an HTTPS origin without credentials, path or query.');
  }
  const hashes = [];
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/i.test(script[1])) continue;
    // HTML parsing normalizes CRLF and lone CR to LF before CSP hashes the script.
    const source = script[2].replace(/\r\n?/g, '\n');
    if (source.trim()) hashes.push(`'sha256-${createHash('sha256').update(source).digest('base64')}'`);
  }
  const policy = [
    "default-src 'none'",
    `script-src 'self' ${[...new Set(hashes)].join(' ')}`.trim(),
    "script-src-attr 'none'",
    // React uses inline styles for gallery sizing, animation and modal scroll locks.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' ${endpoint.origin} data: blob:`,
    `connect-src 'self' ${endpoint.origin} wss://${endpoint.host}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  return {
    'Content-Security-Policy': policy,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

async function main() {
  const env = loadEnv('production', process.cwd(), 'VITE_SUPABASE_URL');
  const html = await readFile('dist/index.html', 'utf8');
  const headers = securityHeaders(html, env.VITE_SUPABASE_URL);
  const destination = '.local/security-headers';
  await mkdir(destination, { recursive: true });
  await writeFile(`${destination}/headers.json`, `${JSON.stringify(headers, null, 2)}\n`);
  await writeFile(`${destination}/nginx.conf`,
    '# Generated for the current dist/index.html. Include in the HTTPS server/location serving the site.\n' +
    Object.entries(headers).map(([name, value]) => `add_header ${name} ${JSON.stringify(value)} always;`).join('\n') + '\n');
  console.log(`Generated ${destination}/headers.json and nginx.conf. GitHub Pages does not apply these files.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
