import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearPasswordRecoveryLink, passwordRecoveryError, passwordRecoveryLink, passwordRecoveryRedirect } from '../lib/password-recovery.ts';

test('recognizes recovery callbacks before the SDK removes tokens, and retains the route on reload', () => {
  assert.deepEqual(passwordRecoveryLink('https://elveria.ru/#access_token=secret&type=recovery'), { requested: true, failed: false });
  assert.deepEqual(passwordRecoveryLink('https://elveria.ru/?auth=recovery'), { requested: true, failed: false });
  assert.equal(passwordRecoveryLink('https://elveria.ru/#type=signup&access_token=secret').requested, false);
  assert.equal(passwordRecoveryLink('https://elveria.ru/#catalog').requested, false);
});

test('expired callbacks remain failed even if an older authenticated session exists', () => {
  for (const url of [
    'https://elveria.ru/?auth=recovery#error=access_denied&error_code=otp_expired',
    'https://elveria.ru/?auth=recovery&error_description=expired',
  ]) assert.deepEqual(passwordRecoveryLink(url), { requested: true, failed: true });
});

test('recovery redirect returns to the deployed app without product, account, or token parameters', () => {
  assert.equal(passwordRecoveryRedirect('https://elveria.ru/?account=admin&work=bird#access_token=secret'), 'https://elveria.ru/?auth=recovery');
  assert.equal(passwordRecoveryRedirect('http://127.0.0.1:5173/subpath/'), 'http://127.0.0.1:5173/subpath/?auth=recovery');
});

test('closing recovery removes credentials and errors while preserving unrelated navigation', () => {
  const clean = clearPasswordRecoveryLink('https://elveria.ru/?auth=recovery&work=bird&code=secret#access_token=secret&refresh_token=secret&type=recovery');
  assert.equal(clean, 'https://elveria.ru/?work=bird');
  assert.equal(clearPasswordRecoveryLink('https://elveria.ru/?auth=recovery#error=access_denied&error_code=otp_expired'), 'https://elveria.ru/');
  assert.equal(clearPasswordRecoveryLink('https://elveria.ru/?auth=recovery#catalog'), 'https://elveria.ru/#catalog');
});

test('auth errors have useful Russian messages without exposing raw provider responses', () => {
  assert.match(passwordRecoveryError({ code: 'same_password' }, ''), /отличаться/);
  assert.match(passwordRecoveryError({ code: 'weak_password' }, ''), /слишком простой/);
  assert.match(passwordRecoveryError({ code: 'over_email_send_rate_limit' }, ''), /Подождите/);
  assert.match(passwordRecoveryError({ code: 'otp_expired' }, ''), /новое письмо/);
  assert.equal(passwordRecoveryError({ message: 'internal details' }, 'Повторите попытку.'), 'Повторите попытку.');
  assert.equal(passwordRecoveryError(null, 'Нет соединения.'), 'Нет соединения.');
});
