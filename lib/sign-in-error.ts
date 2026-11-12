// Classify the original Auth error before its code/name are lost in Error(message).
// Never return server messages: they can contain internal details or personal data.
export function signInError(error: unknown): string {
  const detail = typeof error === "object" && error !== null ? error : {};
  const code = "code" in detail ? detail.code : undefined;
  const status = "status" in detail ? detail.status : undefined;
  const name = "name" in detail ? detail.name : undefined;
  switch (code) {
    case "invalid_credentials":
      return "Неверный email или пароль. Проверьте введённые данные или нажмите «Забыли пароль?».";
    case "email_not_confirmed":
      return "Почта не подтверждена. Откройте письмо, отправленное при регистрации, и перейдите по ссылке для подтверждения. Если письма нет во входящих, проверьте папку «Спам».";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Слишком много попыток входа. Подождите немного и попробуйте снова.";
    case "request_timeout":
      return "Не удалось связаться с сервером. Проверьте соединение с интернетом и попробуйте снова.";
  }
  if (status === 429) return "Слишком много попыток входа. Подождите немного и попробуйте снова.";
  if (name === "AuthRetryableFetchError" && status === 0) {
    return "Не удалось связаться с сервером. Проверьте соединение с интернетом и попробуйте снова.";
  }
  return "Не удалось войти. Попробуйте ещё раз немного позже.";
}
