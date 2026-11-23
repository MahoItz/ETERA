import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import type { DashboardPeriod } from "./admin-dashboard";

type Traffic = {
  visitors: number;
  visits: number;
  pageviews: number;
  started_at: string;
  days: Array<{ date: string; visitors: number; visits: number; pageviews: number }>;
};
const number = (value: number) => new Intl.NumberFormat("ru-RU").format(value);
const date = (value: string) => new Date(`${value}T12:00:00+03:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "short", timeZone: "Europe/Moscow" });

export function SiteTraffic({ period, refresh }: { period: DashboardPeriod; refresh: number }) {
  const [data, setData] = useState<Traffic | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    setData(null);
    void (async () => {
      try {
        const result = await supabase.rpc("admin_site_traffic", { period_days: period }).abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        if (result.error || !result.data) {
          setError(result.error?.code === "PGRST202"
            ? "Учёт посещений ещё не подключён. Нужно применить обновление базы данных."
            : "Не удалось загрузить посещаемость. Нажмите «Обновить статистику», чтобы повторить.");
        } else setData(result.data as Traffic);
      } catch {
        if (!controller.signal.aborted) setError("Не удалось загрузить посещаемость. Попробуйте обновить статистику.");
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    })();
    return () => controller.abort();
  }, [period, refresh]);
  const maximum = Math.max(1, ...(data?.days.map(day => day.visitors) ?? []));
  return <section className="account-surface account-traffic" aria-labelledby="traffic-heading" aria-busy={busy}>
    <h2 id="traffic-heading">Посещаемость сайта</h2>
    <p className="account-traffic-intro">За {period} дней, включая гостей без регистрации.</p>
    {busy && <p role="status">Загружаем посещаемость…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {data && <>
      <div className="account-traffic-metrics">
        <div><span>Посетители</span><strong>{number(data.visitors)}</strong></div>
        <div><span>Визиты</span><strong>{number(data.visits)}</strong></div>
        <div><span>Просмотры</span><strong>{number(data.pageviews)}</strong></div>
      </div>
      {data.pageviews > 0 ? <>
        <h3>Посетители по дням</h3>
        <div className="account-traffic-chart" role="img" aria-label={`Уникальные посетители по дням за ${period} дней. Значения доступны в таблице ниже.`}>
          {data.days.map(day => <div key={day.date} title={`${date(day.date)}: ${number(day.visitors)}`}>
            <span style={{ height: `${day.visitors / maximum * 100}%` }} />
          </div>)}
        </div>
        <div className="account-traffic-axis" aria-hidden="true"><span>{date(data.days[0].date)}</span><span>{date(data.days[data.days.length - 1].date)}</span></div>
        <details className="account-traffic-details"><summary>Данные по дням</summary>
          <div className="account-traffic-table"><table><caption className="sr-only">Посещаемость по дням, московское время</caption>
            <thead><tr><th scope="col">Дата</th><th scope="col">Посетители</th><th scope="col">Визиты</th><th scope="col">Просмотры</th></tr></thead>
            <tbody>{data.days.map(day => <tr key={day.date}><th scope="row">{date(day.date)}</th><td>{number(day.visitors)}</td><td>{number(day.visits)}</td><td>{number(day.pageviews)}</td></tr>)}</tbody>
          </table></div>
        </details>
      </> : <p className="account-traffic-intro">Пока посещений нет. Здесь появится график, когда на сайт начнут заходить.</p>}
      <p className="account-stat-note">Посетители определяются по браузеру; визит начинается после 30 минут без просмотров. Учитываются открытия каталога и карточек работ. Администраторы не учитываются. Дни — по московскому времени. Сбор с {new Date(data.started_at).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}.</p>
    </>}
  </section>;
}
