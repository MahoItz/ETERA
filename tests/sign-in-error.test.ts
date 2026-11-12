import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signInError } from '../lib/sign-in-error.ts';

test('login errors provide Russian next steps based on codes, regardless of server wording', () => {
  for (const [code, expected] of [
    ['invalid_credentials', /Неверный email или пароль.*Забыли пароль/],
    ['email_not_confirmed', /Почта не подтверждена.*Спам/],
    ['over_request_rate_limit', /Слишком много попыток.*Подождите/],
    ['over_email_send_rate_limit', /Слишком много попыток.*Подождите/],
    ['request_timeout', /Проверьте соединение/],
  ] as const) {
    const message = signInError({ code, message: 'SECRET_SERVER_DETAIL' });
    assert.match(message, expected);
    assert.ok(!message.includes('SECRET_SERVER_DETAIL'));
  }
});

test('login handles HTTP rate limits and SDK network errors without misclassifying server failures', () => {
  assert.match(signInError({ status: 429 }), /Слишком много попыток/);
  assert.match(signInError({ name: 'AuthRetryableFetchError', status: 0 }), /Проверьте соединение/);
  assert.equal(signInError({ name: 'AuthRetryableFetchError', status: 503 }), signInError(null));
  assert.equal(signInError({ code: 'invalid_credentials', status: 400 }), signInError({ code: 'invalid_credentials' }));
});

test('unknown login errors never expose raw strings, server messages or personal data', () => {
  for (const error of [null, undefined, 'SECRET', 42, new Error('private@example.test'),
    { code: 'future_code', message: 'SECRET' }, { message: '<script>SECRET</script>' }]) {
    assert.equal(signInError(error), 'Не удалось войти. Попробуйте ещё раз немного позже.');
  }
});
