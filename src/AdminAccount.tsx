import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, BarChart3, Heart, Image, LayoutDashboard, MessageCircle, RefreshCw, Settings2, Users } from "lucide-react";
import { loadAdminDashboard, type AdminDashboardData, type DashboardPeriod } from "./admin-dashboard";
import { CatalogImage } from "./CatalogImage";
import { imageUrl } from "./EditorUI";
import "./admin-account.css";

const number = (value: number) => new Intl.NumberFormat("ru-RU").format(value);
const workStatus = (work: AdminDashboardData["popular_works"][number]) =>
  work.availability === "sold" ? "Продано" : work.status === "draft" ? "Черновик"
    : work.status === "archived" ? "В архиве" : "На сайте";

export function AdminAccount({ email, settingsForm, onBack, onOpenWork, section, onSectionChange, messages, unreadCount }: {
  email: string | null;
  settingsForm: ReactNode;
  onBack: () => void;
  onOpenWork: (id: string) => void;
  section: "overview" | "settings" | "messages";
  onSectionChange: (section: "overview" | "settings" | "messages") => void;
  messages: ReactNode;
  unreadCount: number;
}) {
  const [period, setPeriod] = useState<DashboardPeriod>(30);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    setData(null);
    loadAdminDashboard(period, controller.signal).then((result) => {
      if (!controller.signal.aborted) setData(result);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить статистику.");
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false);
    });
    return () => controller.abort();
  }, [period, refresh]);

  return (
    <main className="admin-account">
      <div className="account-page-heading">
        <div><span className="account-eyebrow">МАСТЕРСКАЯ / УПРАВЛЕНИЕ</span>
          <h1 ref={heading} tabIndex={-1}>Личный кабинет</h1>
          <p>Всё важное о вашей мастерской в одном месте.</p>
        </div>
        <button type="button" className="button secondary" onClick={onBack}><ArrowLeft size={16} />На сайт</button>
      </div>
      <div className="account-layout">
        <aside className="account-sidebar">
          <div className="account-identity"><span>Администратор</span><strong>{email}</strong></div>
          <nav aria-label="Разделы личного кабинета">
            <button type="button" aria-current={section === "overview" ? "page" : undefined} onClick={() => onSectionChange("overview")}><LayoutDashboard size={18} />Обзор</button>
            <button type="button" aria-current={section === "messages" ? "page" : undefined} onClick={() => onSectionChange("messages")}><MessageCircle size={18} />Сообщения{unreadCount > 0 && <span className="chat-count">{unreadCount}</span>}</button>
            <button type="button" aria-current={section === "settings" ? "page" : undefined} onClick={() => onSectionChange("settings")}><Settings2 size={18} />Настройки сайта</button>
          </nav>
          <p className="account-sidebar-note">Статистика и настройки доступны только администратору.</p>
        </aside>
        <div className="account-main">
          {section === "messages" ? messages : section === "settings" ? (
            <section className="account-surface account-settings" aria-labelledby="account-settings-heading">
              <h2 id="account-settings-heading">Настройки сайта</h2>
              <p className="form-intro">Название мастерской, оформление шапки и контакты для связи с вами.</p>
              {settingsForm}
            </section>
          ) : (
            <>
              <div className="account-overview-heading">
                <div><h2>Обзор мастерской</h2><p>Общие показатели и интерес к вашим работам.</p></div>
                <div className="account-period-controls">
                  <div className="account-period"><label htmlFor="dashboard-period">Период</label><select id="dashboard-period" value={period} onChange={(event) => setPeriod(Number(event.target.value) as DashboardPeriod)}>
                    <option value={7}>7 дней</option><option value={30}>30 дней</option><option value={90}>90 дней</option>
                  </select></div>
                  <button type="button" className="icon-button" disabled={busy} onClick={() => setRefresh((value) => value + 1)} aria-label="Обновить статистику"><RefreshCw size={18} /></button>
                </div>
              </div>
              {busy && <div className="account-surface account-loading" role="status"><BarChart3 size={26} /><p>Загружаем статистику…</p></div>}
              {error && <div className="account-surface"><p className="form-error" role="alert">{error}</p><button type="button" className="button secondary" onClick={() => setRefresh((value) => value + 1)}>Попробовать снова</button></div>}
              {!busy && data && <>
                <div className="account-stats" aria-label="Показатели сайта">
                  <article className="account-stat"><span><Users size={18} />Пользователи</span><strong>{number(data.total_users)}</strong><p>+{number(data.new_users)} за {period} дней</p></article>
                  <article className="account-stat"><span><Heart size={18} />Сохранения в избранное</span><strong>{number(data.total_favorites)}</strong><p>+{number(data.period_favorites)} за {period} дней</p></article>
                  <article className="account-stat"><span><Image size={18} />Работы в избранном</span><strong>{number(data.favorited_works)}</strong><p>У {number(data.users_with_favorites)} пользователей</p></article>
                  <article className="account-stat"><span><LayoutDashboard size={18} />Работы в каталоге</span><strong>{number(data.total_works)}</strong><p>{number(data.published_works)} на сайте · {number(data.draft_works)} в черновиках · {number(data.archived_works)} в архиве / продано</p></article>
                </div>
                <p className="account-stat-note">Общие числа — за всё время; прибавки — за последние {period} дней. Пользователи включают администраторов. В избранном учитываются текущие сохранения, удалённые не учитываются.</p>
                <section className="account-surface account-popular" aria-labelledby="popular-heading">
                  <div className="account-popular-heading"><div><h2 id="popular-heading">Популярные работы</h2><p>Больше всего сохранений в избранное за всё время.</p></div><Heart size={22} aria-hidden="true" /></div>
                  {data.popular_works.length ? <ol className="account-popular-list">
                    {data.popular_works.map((work, index) => <li key={work.id}>
                      <span className="account-rank" aria-hidden="true">{index + 1}</span>
                      <button type="button" className="account-popular-work" onClick={() => onOpenWork(work.id)}>
                        {work.photo_url ? <CatalogImage src={imageUrl(work.photo_url)} alt="" loading="lazy" /> : <span className="account-photo-placeholder"><Image size={20} /></span>}
                        <span className="account-work-name"><strong>{work.title}</strong><small>{workStatus(work)}</small></span>
                        <ArrowUpRight size={16} aria-hidden="true" />
                      </button>
                      <span className="account-saves"><Heart size={15} aria-hidden="true" /><strong>{number(work.favorites)}</strong><span className="sr-only">сохранений</span></span>
                    </li>)}
                  </ol> : <div className="account-empty"><Heart size={30} /><h3>Здесь появятся любимые работы</h3><p>Когда пользователи начнут сохранять работы в избранное, вы увидите самые популярные.</p></div>}
                </section>
                <p className="account-updated">Обновлено: {new Date(data.generated_at).toLocaleString("ru-RU")}</p>
              </>}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
