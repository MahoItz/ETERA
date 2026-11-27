import { useEffect, useState, type ChangeEvent } from "react";
import { supabase } from "./supabase";
import { validDiagnostic, type Diagnostic } from "../lib/diagnostics";

type Report = Diagnostic & { received_at: string };
const kinds = { network: "Нет соединения", http: "Ошибка HTTP", slow: "Долгое ожидание", body: "Обрыв ответа", catalog: "Ошибка каталога", render: "Ошибка отображения" };
export function SiteDiagnostics() {
  const [reports, setReports] = useState<Report[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [importError, setImportError] = useState("");
  const [notice, setNotice] = useState("");
  const [days, setDays] = useState(7);
  useEffect(() => {
    const controller = new AbortController();
    const deadline = new AbortController();
    const timer = window.setTimeout(() => deadline.abort(), 10000);
    const cancel = () => deadline.abort();
    controller.signal.addEventListener("abort", cancel, { once: true });
    setBusy(true); setError(""); setReports([]);
    void (async () => {
      try {
        const result = await supabase.rpc("admin_site_diagnostics", { period_days: days }).abortSignal(deadline.signal);
        if (controller.signal.aborted) return;
        if (result.error) throw new Error(result.error.code === "PGRST202" ? "Журнал ещё не подключён. Примените миграцию базы данных." : "Не удалось загрузить журнал. Повторите попытку.");
        setReports((result.data ?? []) as Report[]);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить журнал.");
      } finally { clearTimeout(timer); if (!controller.signal.aborted) setBusy(false); }
    })();
    return () => { clearTimeout(timer); controller.abort(); };
  }, [days, refresh]);
  async function importReport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    setNotice(""); setImportError(""); setImporting(true);
    try {
      if (file.size > 40000) throw new Error("Файл слишком большой. Выберите отчёт, скачанный с сайта.");
      const data: unknown = JSON.parse(await file.text());
      if (!data || typeof data !== "object" || !("version" in data) || data.version !== 1 || !("events" in data)
        || !Array.isArray(data.events) || data.events.length < 1 || data.events.length > 20 || !data.events.every(d => validDiagnostic(d))) {
        throw new Error("Нужен отчёт сайта не старше 7 дней, содержащий от 1 до 20 событий.");
      }
      let saved = 0;
      for (const report of data.events) {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 10000);
        let result;
        try { result = await supabase.rpc("record_site_diagnostic", { event: report }).abortSignal(controller.signal); }
        finally { clearTimeout(timer); }
        if (result.error || result.data !== true) throw new Error(`Сохранено ${saved} из ${data.events.length}. Остальные события не приняты; повторите импорт позже.`);
        saved++;
      }
      setNotice(`Отчёт сохранён: ${saved} событий. Повторный импорт не создаёт дубликаты.`);
    } catch (cause) {
      setImportError(cause instanceof SyntaxError ? "Не удалось прочитать JSON-файл отчёта." : cause instanceof Error ? cause.message : "Не удалось импортировать отчёт.");
    } finally { setImporting(false); setRefresh(value => value + 1); }
  }
  return <section className="account-surface site-diagnostics" aria-labelledby="diagnostics-heading" aria-busy={busy || importing}>
    <h2 id="diagnostics-heading">Ошибки загрузки</h2>
    <p>Последние 100 событий за выбранный период, максимум за 30 дней. Отчёты доступны только администратору. Старые записи очищаются при приёме новых отчётов.</p>
    <p>При недоступности базы до 20 событий сохраняются в браузере посетителя на 7 дней. Отправка повторяется при восстановлении связи и следующих посещениях. Если связь не восстановится, попросите посетителя скачать отчёт и передать вам для импорта. При запрете сохранения данных очередь действует только до закрытия страницы.</p>
    <p className="account-stat-note">Отчёты описывают наблюдения браузера и могут быть неполными. Пароли, токены, адреса страниц, IP и содержимое запросов в журнал не записываются. «В сети» означает состояние браузера, а не доступность Supabase.</p>
    <div className="diagnostic-controls">
      <label htmlFor="diagnostic-period">Период <select id="diagnostic-period" value={days} onChange={e => setDays(Number(e.target.value))}><option value={1}>Сутки</option><option value={7}>7 дней</option><option value={30}>30 дней</option></select></label>
      <button type="button" className="button secondary" disabled={busy || importing} onClick={() => setRefresh(value => value + 1)}>Обновить журнал</button>
      <label className="diagnostic-import" htmlFor="diagnostic-file">Импорт отчёта посетителя<input id="diagnostic-file" aria-label="Импорт отчёта посетителя" type="file" accept="application/json,.json" disabled={importing || busy} onChange={event => void importReport(event)} /></label>
    </div>
    {busy && <p role="status">Загружаем журнал…</p>}
    {importing && <p role="status">Сохраняем отчёт…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {importError && <p className="form-error" role="alert">{importError}</p>}
    {notice && <p role="status">{notice}</p>}
    {!busy && !error && reports.length === 0 && <p>Сохранённых ошибок за этот период нет. Это не гарантирует, что все посетители смогли подключиться.</p>}
    <div className="diagnostic-reports">{reports.map(report => <article key={report.id}>
      <h3>{kinds[report.kind] ?? "Ошибка загрузки"} · {report.resource}</h3>
      <p><time dateTime={report.occurred_at}>{new Date(report.occurred_at).toLocaleString("ru-RU")}</time> · {report.browser} / {report.platform}</p>
      <p>{report.method} · HTTP {report.status || "не получен"} · {(report.duration_ms / 1000).toFixed(1)} с · {report.online ? "В сети" : "Нет сети"}</p>
      <p>Код: <code>{report.id}</code> · Версия: <code>{report.build}</code></p>
      <small>Получен: {new Date(report.received_at).toLocaleString("ru-RU")}. Время события и устройство сообщены браузером.</small>
    </article>)}</div>
  </section>;
}
