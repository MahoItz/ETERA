const authParameters = [
  "access_token", "refresh_token", "expires_in", "expires_at", "token_type",
  "type", "code", "error", "error_code", "error_description",
];

export function passwordRecoveryLink(href: string) {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  return {
    requested: url.searchParams.get("auth") === "recovery"
      || (url.searchParams.get("type") ?? hash.get("type")) === "recovery",
    failed: ["error", "error_code", "error_description"].some(
      (key) => url.searchParams.has(key) || hash.has(key),
    ),
  };
}

export function passwordRecoveryRedirect(siteUrl: string) {
  const url = new URL(siteUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set("auth", "recovery");
  return url.href;
}

export function clearPasswordRecoveryLink(href: string) {
  const url = new URL(href);
  if (url.searchParams.get("auth") === "recovery") url.searchParams.delete("auth");
  for (const key of authParameters) url.searchParams.delete(key);
  const hash = new URLSearchParams(url.hash.slice(1));
  if (authParameters.some((key) => hash.has(key))) url.hash = "";
  return url.href;
}

export function passwordRecoveryError(error: unknown, fallback: string) {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : "";
  switch (code) {
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Слишком много попыток. Подождите немного и попробуйте снова.";
    case "same_password":
      return "Новый пароль должен отличаться от прежнего.";
    case "weak_password":
      return "Пароль слишком простой. Сделайте его длиннее, добавьте буквы, цифры и специальные символы.";
    case "otp_expired":
    case "session_not_found":
    case "session_expired":
    case "refresh_token_not_found":
      return "Ссылка устарела или уже использована. Запросите новое письмо для восстановления пароля.";
    default:
      return fallback;
  }
}
