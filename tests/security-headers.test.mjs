import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { securityHeaders } from '../scripts/security-headers.mjs';

test('policy allows only application origins, blocks framing, and keeps previews and realtime', () => {
  const headers = securityHeaders('<script src="/assets/app.js"></script>', 'https://backend.example');
  const csp = headers['Content-Security-Policy'];
  assert.ok(csp.includes("default-src 'none'"));
  assert.ok(csp.includes("script-src 'self';"));
  assert.ok(csp.includes("script-src-attr 'none'"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.ok(csp.includes("object-src 'none'"));
  assert.ok(csp.includes("base-uri 'none'"));
  assert.ok(csp.includes("img-src 'self' https://backend.example data: blob:"));
  assert.ok(csp.includes("connect-src 'self' https://backend.example wss://backend.example"));
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.ok(!csp.includes('unsafe-eval') && !csp.includes('*'));
});

test('inline recovery is allowed by its exact built bytes, without allowing arbitrary scripts', () => {
  const source = '\n  window.recoveryReady = true;\n';
  const expectedHash = createHash('sha256').update(source).digest('base64');
  const html = `<script id="asset-recovery">${source}</script><script src="/assets/app.js"></script>`;
  const csp = securityHeaders(html, 'https://backend.example')['Content-Security-Policy'];
  assert.ok(csp.includes(`script-src 'self' 'sha256-${expectedHash}';`));
  const changed = securityHeaders(html.replace('true', 'false'), 'https://backend.example')['Content-Security-Policy'];
  assert.ok(!changed.includes(expectedHash));
});

test('invalid backend URLs cannot widen the policy or inject headers', () => {
  for (const origin of ['http://backend.example', 'https://user:pass@backend.example', 'https://backend.example/path',
    'https://backend.example/?query=x', 'https://backend.example/#fragment', "https://backend.example/; script-src *", undefined]) {
    assert.throws(() => securityHeaders('', origin));
  }
});

test('Windows and Unix HTML line endings produce the browser-normalized inline hash', () => {
  const html = '<script>\nwindow.ready = true;\n</script>';
  const expected = securityHeaders(html, 'https://backend.example');
  assert.deepEqual(securityHeaders(html.replaceAll('\n', '\r\n'), 'https://backend.example'), expected);
  assert.deepEqual(securityHeaders(html.replaceAll('\n', '\r'), 'https://backend.example'), expected);
});
