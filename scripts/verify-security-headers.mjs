import { securityHeaders } from './security-headers.mjs';
import { loadEnv } from 'vite';

const target = new URL(process.argv[2] || 'https://elveria.ru/');
if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))) {
  throw new Error('Use HTTPS, or HTTP on localhost for a local check.');
}
const response = await fetch(target, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000) });
if (response.status !== 200 || !response.headers.get('content-type')?.includes('text/html')) {
  throw new Error(`Expected HTML with HTTP 200, received ${response.status}.`);
}
const env = loadEnv('production', process.cwd(), 'VITE_SUPABASE_URL');
const expected = securityHeaders(await response.text(), env.VITE_SUPABASE_URL);
const failures = Object.entries(expected).filter(([name, value]) => response.headers.get(name) !== value).map(([name]) => name);
if (failures.length) {
  console.error(`Missing or unexpected security headers: ${failures.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('Security headers match the served HTML and configured backend; frame-ancestors and X-Frame-Options deny embedding.');
}
