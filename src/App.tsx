import { CatalogImage } from "./CatalogImage";
import { MasterContacts } from "./MasterContacts";
import { ProductChat } from "./ProductChat";
import { ChatInbox } from "./ChatInbox";
import { ChatNotifications } from "./ChatNotifications";
import { useChatInbox } from "./useChatInbox";
import "./chat.css";
import { SizeDiagram } from "./SizeDiagram";
import { variantPhotos } from "../lib/variant-gallery";
import { Modal, UnsavedChangesDialog, imageUrl, compressPhoto } from "./EditorUI";
import { TreeHero } from "./TreeHero";
import { treeItems, type TreeOrnament } from "./tree-items";
import { useOrnamentSort } from "./useOrnamentSort";
import {
  useEffect,
  lazy,
  Suspense,
  useRef,
  useState,
  type FormEvent,
} from "react";

const PhotoLightbox = lazy(() => import("./PhotoLightbox").then((module) => ({ default: module.PhotoLightbox })));
const WorkEditor = lazy(() => import("./WorkEditor").then((module) => ({ default: module.WorkEditor })));
const AdminAccount = lazy(() => import("./AdminAccount").then((module) => ({ default: module.AdminAccount })));
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Flower2,
  Heart,
  GripVertical,
  ImagePlus,
  Images,
  Maximize2,
  Eye,
  LogOut,
  MessageCircle,
  LockKeyhole,
  Pause,
  Play,
  Plus,
  Pencil,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Star,
  Trash2,
  Upload,
  UserRound,
  X,
  Loader2,
} from "lucide-react";
import {
  defaults,
  filterWorks,
  catalogPrice,
  visibleWorks,
  type Work,
  type Settings,
} from "../lib/model";
import {
  getAdminSession,
  getSession,
  loadFavoriteWorkIds,
  addFavorite,
  removeFavorite,
  loadCatalog,
  saveSettings,
  saveCategories,
  type CategoryDraft,
  signIn,
  signUp,
  signOut,
  uploadPhoto,
  renewUploadedPhoto,
  saveTreeOrnament,
  saveTreeOrnamentOrder,
  deleteTreeOrnament,
} from "./catalog";
const money = (n: number | null) =>
  n === null
    ? "Цена по запросу"
    : new Intl.NumberFormat("ru-RU").format(n) + " ₽";
const labels = { available: "В наличии", order: "Под заказ", sold: "Продано" };
const catalogMoney = (work: Work) => {
  const price = catalogPrice(work);
  return (work.variants.length && !work.soldAsSet && price !== null ? "от " : "") + money(price);
};
type CatalogHistoryState = { catalogRoute?: true; version?: 2; dialogDepth?: number };

function catalogLocation() {
  const url = new URL(window.location.href);
  const workId = url.searchParams.get("work");
  return { workId, variantId: workId ? url.searchParams.get("variant") : null };
}
function SortDropdown({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const root = useRef<HTMLDetailsElement>(null);
  const options = [["new", "Сначала избранное и новое"], ["name", "По названию"], ["price", "По цене"]];

  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target) && root.current) root.current.open = false;
    };
    document.addEventListener("click", closeOutside);
    return () => document.removeEventListener("click", closeOutside);
  }, []);

  return (
    <details className="sort-dropdown" ref={root} onKeyDown={(event) => {
      if (event.key === "Escape" && root.current) {
        root.current.open = false;
        root.current.querySelector("summary")?.focus();
      }
    }}>
      <summary className="sort" aria-label="Сортировка">
        <SlidersHorizontal size={16} />
        <span>{options.find(([key]) => key === value)?.[1]}</span>
        <ChevronDown size={16} className="sort-chevron" />
      </summary>
      <div className="sort-options" role="group" aria-label="Порядок сортировки">
        {options.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={value === key} onClick={() => {
            onChange(key);
            if (root.current) {
              root.current.open = false;
              root.current.querySelector("summary")?.focus();
            }
          }}>
            <span>{label}</span><Check size={16} aria-hidden="true" />
          </button>
        ))}
      </div>
    </details>
  );
}

export default function Catalog() {
  const motionRoot = useRef<HTMLDivElement>(null);
  const accountMenu = useRef<HTMLDetailsElement>(null);
  const workOpener = useRef<HTMLElement | null>(null);
  const favoriteRequestPending = useRef(false);
  const favoriteFeedback = useRef<HTMLParagraphElement>(null);
  const [favoriteNotice, setFavoriteNotice] = useState<{
    workId: string; message: string; error: boolean;
  } | null>(null);
  const [motionPaused, setMotionPaused] = useState(false);
  const [ornaments, setOrnaments] = useState<TreeOrnament[]>([]);
  const [treeEditor, setTreeEditor] = useState(false);
  const [works, setWorks] = useState<Work[]>([]),
    [settings, setSettings] = useState<Settings>(defaults),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [admin, setAdmin] = useState(false),
    [userId, setUserId] = useState<string | null>(null),
    [userEmail, setUserEmail] = useState<string | null>(null),
    [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set()),
    [favoriteBusy, setFavoriteBusy] = useState<string | null>(null),
    [accountOpen, setAccountOpen] = useState(false),
    [adminAccountOpen, setAdminAccountOpen] = useState(() => new URL(window.location.href).searchParams.get("account") === "admin"),
    [editingEnabled, setEditingEnabled] = useState(true),
    [signingOut, setSigningOut] = useState(false),
    [accountError, setAccountError] = useState(""),
    [loginOpen, setLoginOpen] = useState(false),
    [scope, setScope] = useState("published"),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState(""),
    [sort, setSort] = useState("new"),
    [limit, setLimit] = useState(24);
  const [selected, setSelected] = useState<Work | null>(null),
    [photoIndex, setPhotoIndex] = useState(0),
    [lightboxOpen, setLightboxOpen] = useState(false),
    [selectedVariantId, setSelectedVariantId] = useState<string | null>(null),
    [editing, setEditing] = useState<Work | null | undefined>(undefined);
  const [settingsSection, setSettingsSection] = useState<"general" | "categories" | null>(null);
  const [adminSection, setAdminSection] = useState<"overview" | "settings" | "messages">("overview");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const chatInbox = useChatInbox(userId);
  const selectedVariant = selected?.variants.find((variant) => variant.id === selectedVariantId) ?? null;
  const collectionOverview = Boolean(selected?.variants.length && !selected.soldAsSet && !selectedVariant);
  const selectedMeasurements = selectedVariant ? selectedVariant.measurements ?? null : collectionOverview ? null : selected?.measurements;
  const selectedPhotos = selectedVariant ? variantPhotos(selectedVariant) : selected?.photos ?? [];
  const lightboxPhotos = selectedPhotos;
  const selectedPrice = selectedVariant ? selectedVariant.price : selected?.price ?? null;
  const canEdit = admin && editingEnabled;
  async function load() {
    setError("");
    setLoading(true);
    try {
      const [data, currentSession, adminSession] = await Promise.all([
        loadCatalog(),
        getSession(),
        getAdminSession(),
      ]);
      const favorites = currentSession ? await loadFavoriteWorkIds() : new Set<string>();
      setWorks(data.works);
      setOrnaments(data.ornaments);
      setSettings(data.settings);
      setAdmin(Boolean(adminSession));
      setUserEmail(currentSession?.user.email ?? null);
      setUserId(currentSession?.user.id ?? null);
      setFavoriteIds(favorites);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить каталог");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  useEffect(() => {
    if (loading) return;
    const applyLocation = () => {
      setAdminAccountOpen(new URL(window.location.href).searchParams.get("account") === "admin");
      const section = new URL(window.location.href).searchParams.get("section");
      setAdminSection(section === "messages" || section === "settings" ? section : "overview");
      setSelectedThreadId(new URL(window.location.href).searchParams.get("conversation"));
      const { workId, variantId } = catalogLocation();
      const work = works.find((item) => (item.slug === workId || item.id === workId)
        && (canEdit || (item.status === "published" && item.availability !== "sold"))) ?? null;
      setLightboxOpen(false);
      setSelected(work);
      setPhotoIndex(0);
      setSelectedVariantId(work?.variants.find((variant) => variant.slug === variantId || variant.id === variantId)?.id ?? null);
    };
    const current = history.state as CatalogHistoryState | null;
    if (!current?.catalogRoute || current.version !== 2) {
      const originalUrl = window.location.href;
      const { workId } = catalogLocation();
      const catalogUrl = new URL(originalUrl);
      catalogUrl.searchParams.delete("work");
      catalogUrl.searchParams.delete("variant");
      // A shared product URL also needs a catalogue entry to close back to.
      history.replaceState({ catalogRoute: true, version: 2, dialogDepth: 0 }, "", catalogUrl.href);
      if (workId) history.pushState({ catalogRoute: true, version: 2, dialogDepth: 1 }, "", originalUrl);
    }
    applyLocation();
    window.addEventListener("popstate", applyLocation);
    return () => window.removeEventListener("popstate", applyLocation);
  }, [loading, works, canEdit]);
  useEffect(() => {
    const closeMenu = (event: PointerEvent) => {
      const menu = accountMenu.current;
      if (menu && event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false;
      }
    };
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!favoriteNotice) return;
    const timer = setTimeout(() => setFavoriteNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [favoriteNotice]);
  useEffect(() => {
    if (selected?.id === favoriteNotice?.workId) {
      favoriteFeedback.current?.scrollIntoView({ block: "nearest" });
    }
  }, [favoriteNotice, selected?.id]);
  useEffect(() => {
    if (selected || !workOpener.current) return;
    const trigger = workOpener.current;
    workOpener.current = null;
    const frame = requestAnimationFrame(() => {
      if (trigger.isConnected) trigger.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [selected]);
  useEffect(() => {
    setLimit(24);
  }, [query, category, sort, scope, canEdit]);
  useEffect(() => {
    if (lightboxOpen || selectedPhotos.length < 2) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && (e.target.matches("input, textarea, select") || e.target.isContentEditable)) return;
      if (e.key === "ArrowRight") {
        setPhotoIndex((i) => (i + 1) % selectedPhotos.length);
      }
      if (e.key === "ArrowLeft") {
        setPhotoIndex(
          (i) => (i + selectedPhotos.length - 1) % selectedPhotos.length,
        );
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedPhotos.length, lightboxOpen]);
  useEffect(() => {
    if (
      motionPaused ||
      !motionRoot.current ||
      !("IntersectionObserver" in window)
    )
      return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches) return;
    const elements = Array.from(
      motionRoot.current.querySelectorAll<HTMLElement>("[data-reveal]"),
    ).filter((el) => !el.classList.contains("is-visible"));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.07 },
    );
    for (const element of elements) {
      element.classList.add("reveal-pending");
      observer.observe(element);
    }
    const reduce = () => {
      if (media.matches) {
        for (const el of elements) el.classList.add("is-visible");
        observer.disconnect();
      }
    };
    media.addEventListener("change", reduce);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", reduce);
      for (const el of elements) el.classList.remove("reveal-pending");
    };
  }, [loading, canEdit, query, category, sort, scope, limit, motionPaused, adminAccountOpen]);
  const publicWorks = visibleWorks(works);
  const categories = [
    ...new Set([
      ...settings.categories,
      ...(canEdit ? works : publicWorks).map((w) => w.category),
    ]),
  ];
  const source = canEdit
    ? works.filter(
        (w) =>
          scope === "all" ||
          (scope === "draft"
            ? w.status === "draft"
            : scope === "archived"
              ? w.status === "archived" || w.availability === "sold"
              : w.status === "published" && w.availability !== "sold"),
      )
    : publicWorks;
  const filtered = filterWorks(source, query, category, sort);
  function navigateAccount(show: boolean) {
    const url = new URL(window.location.href);
    if (show) url.searchParams.set("account", "admin");
    else url.searchParams.delete("account");
    url.searchParams.delete("work");
    url.searchParams.delete("variant");
    url.searchParams.delete("section");
    url.searchParams.delete("conversation");
    url.hash = "";
    history.pushState({ catalogRoute: true, version: 2, dialogDepth: 0 }, "", url.href);
    setAdminAccountOpen(show);
    setAdminSection("overview");
    setSelectedThreadId(null);
    setSelected(null);
    setSelectedVariantId(null);
    setLightboxOpen(false);
    setAccountOpen(false);
    if (accountMenu.current) accountMenu.current.open = false;
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function changeAdminSection(section: "overview" | "settings" | "messages", conversationId: string | null = null) {
    const url = new URL(window.location.href);
    if (section === "overview") url.searchParams.delete("section"); else url.searchParams.set("section", section);
    if (conversationId) url.searchParams.set("conversation", conversationId); else url.searchParams.delete("conversation");
    history.replaceState(history.state, "", url.href);
    setAdminSection(section); setSelectedThreadId(conversationId);
  }
  function openMessages(conversationId: string | null) {
    if (accountMenu.current) accountMenu.current.open = false;
    if (admin) { navigateAccount(true); changeAdminSection("messages", conversationId); }
    else { setSelectedThreadId(conversationId); setMessagesOpen(true); setAccountOpen(false); }
  }
  function openAccountWork(id: string) {
    const work = works.find((item) => item.id === id);
    if (!work) {
      setNotice("Работа больше недоступна. Обновите каталог.");
      return;
    }
    setEditingEnabled(true);
    open(work);
  }
  function updateCatalogUrl(workId: string | null, variantId: string | null, action: "push" | "replace") {
    const url = new URL(window.location.href);
    if (workId) url.hash = "";
    if (workId) url.searchParams.set("work", workId);
    else url.searchParams.delete("work");
    if (workId && variantId) url.searchParams.set("variant", variantId);
    else url.searchParams.delete("variant");
    if (url.href === window.location.href) return;
    const current = history.state as CatalogHistoryState | null;
    const state: CatalogHistoryState = {
      catalogRoute: true,
      version: 2,
      // Count actual pushed entries, not the number of URL parameters.
      // Replacing a photo or variant does not remove earlier history entries.
      dialogDepth: workId ? (current?.dialogDepth ?? 0) + (action === "push" ? 1 : 0) : 0,
    };
    if (action === "push") history.pushState(state, "", `${url.pathname}${url.search}${url.hash}`);
    else history.replaceState(state, "", `${url.pathname}${url.search}${url.hash}`);
  }
  function open(w: Work) {
    workOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLightboxOpen(false);
    setSelected(w);
    setPhotoIndex(0);
    setSelectedVariantId(null);
    updateCatalogUrl(w.slug ?? w.id, null, "push");
  }
  function closeWork() {
    const current = history.state as CatalogHistoryState | null;
    setLightboxOpen(false);
    setSelected(null);
    setSelectedVariantId(null);
    if (current?.catalogRoute && current.version === 2 && current.dialogDepth) {
      history.go(-current.dialogDepth);
      return;
    }
    updateCatalogUrl(null, null, "replace");
  }
  function selectVariant(variantId: string | null, action: "push" | "replace" = "push") {
    setPhotoIndex(0);
    setLightboxOpen(false);
    setSelectedVariantId(variantId);
    if (selected) updateCatalogUrl(selected.slug ?? selected.id, selected.variants.find((variant) => variant.id === variantId)?.slug ?? variantId, action);
  }
  function selectCatalogPhoto(index: number) {
    setPhotoIndex(index);
  }
  function moveCatalogPhoto(direction: 1 | -1) {
    if (!selectedPhotos.length) return;
    setPhotoIndex((index) =>
      (index + selectedPhotos.length + direction) % selectedPhotos.length,
    );
  }
  function saved(w: Work) {
    setWorks((list) => [w, ...list.filter((x) => x.id !== w.id)]);
    setScope(
      w.status === "draft" ? "draft"
        : w.status === "archived" || w.availability === "sold" ? "archived"
          : "published",
    );
    setQuery("");
    setCategory("");
    setEditing(undefined);
    setNotice("Работа сохранена. Она доступна и с другого устройства.");
  }
  async function removeWork(work: Work) {
    setWorks((items) => items.filter((item) => item.id !== work.id));
    setOrnaments((items) => items.filter((item) => item.workId !== work.id));
    if (selected?.id === work.id) closeWork();
    setEditing(undefined);
    setNotice("Работа удалена.");
  }
  function toggleEditing() {
    setEditingEnabled((enabled) => !enabled);
    setScope("published");
    setCategory("");
    setEditing(undefined);
    setTreeEditor(false);
    setSettingsSection(null);
    closeWork();
    if (accountMenu.current) accountMenu.current.open = false;
  }
  async function logout() {
    setSigningOut(true);
    setAccountError("");
    try {
      await signOut();
      setAdmin(false);
      setUserEmail(null);
      setUserId(null);
      setMessagesOpen(false);
      setSelectedThreadId(null);
      setFavoriteIds(new Set());
      setFavoriteNotice(null);
      setAccountOpen(false);
      if (adminAccountOpen) navigateAccount(false);
      setEditingEnabled(true);
      setWorks((items) => visibleWorks(items));
      closeWork();
      setEditing(undefined);
      setTreeEditor(false);
      setSettingsSection(null);
      setScope("published");
      setCategory("");
    } catch (e) {
      setAccountError(e instanceof Error ? e.message : "Не удалось выйти. Попробуйте ещё раз.");
    } finally {
      setSigningOut(false);
    }
  }
  async function toggleFavorite(work: Work) {
    if (!userEmail) {
      setLoginOpen(true);
      return;
    }
    if (favoriteRequestPending.current) return;
    favoriteRequestPending.current = true;
    const wasFavorite = favoriteIds.has(work.id);
    setFavoriteNotice(null);
    setFavoriteBusy(work.id);
    try {
      if (wasFavorite) await removeFavorite(work.id);
      else await addFavorite(work.id);
      setFavoriteIds((ids) => {
        const next = new Set(ids);
        if (wasFavorite) next.delete(work.id);
        else next.add(work.id);
        return next;
      });
      setFavoriteNotice({
        workId: work.id,
        message: wasFavorite ? "Работа удалена из избранного." : "Работа добавлена в избранное.",
        error: false,
      });
    } catch {
      setFavoriteNotice({
        workId: work.id,
        message: wasFavorite
          ? "Не удалось убрать работу из избранного. Попробуйте ещё раз."
          : "Не удалось добавить работу в избранное. Попробуйте ещё раз.",
        error: true,
      });
    } finally {
      favoriteRequestPending.current = false;
      setFavoriteBusy(null);
    }
  }
  return (
    <div
      ref={motionRoot}
      className={"studio-shell" + (motionPaused ? " motion-paused" : "")}
    >
      <header className={"header" + (adminAccountOpen ? " account-header" : "")}>
        <a className="brand" href={adminAccountOpen ? import.meta.env.BASE_URL : "#"} onClick={adminAccountOpen ? (event) => { event.preventDefault(); navigateAccount(false); } : undefined}>
          <span className="brand-symbol">
            <Flower2 size={26} />
          </span>
          <span>
            {settings.name}
            <small>ДЕКОР С ХАРАКТЕРОМ</small>
          </span>
        </a>
        <nav hidden={adminAccountOpen}>
          <a href="#catalog">Коллекция</a>
          <a href="#story">О мастерской</a>
        </nav>
        <div className="header-account-actions">
        {userId && <ChatNotifications inbox={chatInbox} onOpen={openMessages} />}
        {admin ? (
          <details
            className="account-menu"
            ref={accountMenu}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
              }
            }}
            onBlur={(event) => {
              if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
                event.currentTarget.open = false;
              }
            }}
          >
            <summary className="admin-toggle">
              <UserRound size={16} /><span>Аккаунт</span><ChevronDown size={13} />
            </summary>
            <div className="account-panel">
              <span className="account-caption">Администратор</span>
              <button type="button" onClick={toggleEditing} disabled={signingOut} aria-pressed={editingEnabled}>
                {editingEnabled ? <Eye size={16} /> : <Pencil size={16} />}
                {editingEnabled ? "Скрыть кнопки редактирования" : "Показать кнопки редактирования"}
              </button>
              <button
                type="button"
                disabled={signingOut}
                onClick={() => {
                  navigateAccount(true);
                }}
              >
                <UserRound size={16} />Личный кабинет
              </button>
              <button type="button" disabled={signingOut} onClick={() => void logout()}>
                <LogOut size={16} />{signingOut ? "Выходим…" : "Выйти"}
              </button>
              {accountError && <p className="form-error" role="alert">{accountError}</p>}
            </div>
          </details>
        ) : userEmail ? (
          <details className="account-menu" ref={accountMenu}>
            <summary className="admin-toggle"><UserRound size={16} /><span>Аккаунт</span><ChevronDown size={13} /></summary>
            <div className="account-panel">
              <span className="account-caption">{userEmail}</span>
              <button type="button" onClick={() => { setAccountOpen(true); if (accountMenu.current) accountMenu.current.open = false; }}>
                <Heart size={16} />Избранное ({favoriteIds.size})
              </button>
              <button type="button" onClick={() => openMessages(null)}><MessageCircle size={16} />Сообщения{chatInbox.unread_count > 0 && <span className="chat-count">{chatInbox.unread_count}</span>}</button>
              <button type="button" disabled={signingOut} onClick={() => void logout()}>
                <LogOut size={16} />{signingOut ? "Выходим…" : "Выйти"}
              </button>
              {accountError && <p className="form-error" role="alert">{accountError}</p>}
            </div>
          </details>
        ) : (
          <button className="admin-toggle" onClick={() => setLoginOpen(true)} disabled={loading}>
            <UserRound size={16} /><span>Войти</span>
          </button>
        )}
        </div>
      </header>
      {adminAccountOpen ? (
        admin ? <Suspense fallback={<main className="account-access" role="status">Загружаем личный кабинет…</main>}>
          <AdminAccount
            email={userEmail}
            onBack={() => navigateAccount(false)}
            onOpenWork={openAccountWork}
            section={adminSection}
            onSectionChange={changeAdminSection}
            unreadCount={chatInbox.unread_count}
            messages={userId && <ChatInbox inbox={chatInbox} userId={userId} admin requestedId={selectedThreadId} />}
            settingsForm={<SettingsEditor embedded settings={settings} section="general" onClose={() => navigateAccount(false)} onSaved={(next) => {
              setSettings(next);
              setNotice("Настройки сохранены");
            }} />}
          />
        </Suspense> : <main className="account-access">
          <h1>Личный кабинет</h1>
          {loading ? <p role="status">Проверяем доступ…</p> : <>
            <p>{error || (userEmail ? "Этот раздел доступен только администратору." : "Войдите в аккаунт администратора, чтобы увидеть статистику и настройки сайта.")}</p>
            <div className="account-access-actions">
              {!userEmail && <button className="button primary" type="button" onClick={() => setLoginOpen(true)}>Войти</button>}
              <button className="button secondary" type="button" onClick={() => navigateAccount(false)}>На сайт</button>
            </div>
          </>}
        </main>
      ) : <>
      <TreeHero
        works={works}
        ornaments={ornaments}
        ready={!loading && !error}
        onOpen={open}
        stopMotion={motionPaused || selected !== null || treeEditor}
        editorActions={canEdit ? (
          <button className="button secondary" onClick={() => setTreeEditor(true)}>
            <Settings2 size={16} />Управление украшениями
          </button>
        ) : undefined}
      />

      <main id="catalog" className="catalog-section">
        <div className="section-top" data-reveal>
          <div>
            <h2>
              Выберите <em>украшение</em>
            </h2>
          </div>
        </div>
        <div className="toolbar" data-reveal>
          <div className="category-controls">
            <div className="catalog-filter-group">
              <div className="category-tabs" aria-label="Фильтр по категориям">
                <button
                  className={!category ? "chosen" : ""}
                  onClick={() => setCategory("")}
                >
                  Все работы
                </button>
                {categories.map((c) => (
                  <button
                    key={c}
                    className={category === c ? "chosen" : ""}
                    onClick={() => setCategory(c)}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            {canEdit && (
              <button className="context-action" onClick={() => setSettingsSection("categories")}>
                <Settings2 size={15} />Редактировать категории
              </button>
            )}
          </div>
          {canEdit && (
            <div className="catalog-admin-toolbar">
              <div className="admin-scope-panel">
                <div className="scope-tabs" aria-label="Статус работ">
                  {[
                    ["published", "В каталоге"],
                    ["draft", "Черновики"],
                    ["archived", "Архив и проданные"],
                    ["all", "Все"],
                  ].map(([k, v]) => (
                    <button
                      key={k}
                      className={scope === k ? "chosen" : ""}
                      onClick={() => setScope(k)}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <button className="button primary" onClick={() => setEditing(null)}>
                <Plus size={18} />
                Добавить работу
              </button>
            </div>
          )}
          <div className="search-sort">
            <label className="search">
              <Search size={17} />
              <input
                placeholder="Найти что-то особенное"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Поиск работ"
              />
              {query && (
                <button
                  className="clear-search"
                  onClick={() => setQuery("")}
                  aria-label="Очистить поиск"
                >
                  <X size={14} />
                </button>
              )}
            </label>
            <SortDropdown value={sort} onChange={setSort} />
          </div>
        </div>
        {error ? (
          <div className="empty">
            <h3>Не удалось загрузить работы</h3>
            <p>{error}</p>
            <button className="button primary" onClick={load}>
              Попробовать снова
            </button>
          </div>
        ) : loading ? (
          <div className="loading">
            <Loader2 className="spin" />
            Загружаем коллекцию…
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <Flower2 size={34} />
            <h3>
              {query || category
                ? "Пока ничего не нашлось"
                : "Здесь появятся новые истории"}
            </h3>
            <p>
              {query || category
                ? "Попробуйте другое название или категорию."
                : canEdit
                  ? "Нажмите «Добавить работу», чтобы пополнить каталог. Если работа уже есть, проверьте черновики и архив."
                  : "Скоро здесь появятся новые работы."}
            </p>
            {(query || category) && (
              <button
                className="button secondary"
                onClick={() => {
                  setQuery("");
                  setCategory("");
                }}
              >
                Сбросить фильтры
              </button>
            )}
          </div>
        ) : (
          <div className="grid">
            {filtered.slice(0, limit).map((w, i) => (
              <article
                key={w.id}
                className={"work-card card-" + i}
                data-reveal
              >
                <div className="card-photo">
                  {w.photos[0] ? (
                    <CatalogImage
                      src={imageUrl(w.photos[0].url)}
                      alt={w.photos[0].alt || w.title}
                      loading="lazy"
                    />
                  ) : (
                    <div className="photo-placeholder">
                      <ImagePlus size={34} />
                    </div>
                  )}
                  <span className="status-pill">
                    {canEdit && w.status !== "published"
                      ? w.status === "draft"
                        ? "Черновик"
                        : "Архив"
                      : labels[w.availability]}
                  </span>
                  {w.featured && (
                    <span
                      className="featured-icon"
                      aria-label="Выбор мастера"
                      title="Выбор мастера"
                    >
                      <Star size={15} />
                    </span>
                  )}
                  {w.photos.length > 0 && (
                    <span className="card-photo-count">
                      <Images size={14} aria-hidden="true" />{w.photos.length} фото
                    </span>
                  )}
                </div>
                <div className="card-info">
                  <div className="card-meta">
                    {w.category && <span className="card-category">{w.category}</span>}
                    <span className="card-material">{w.material || "Ручная работа"}</span>
                  </div>
                  <h3 className="card-title">
                    <button type="button" className="title-button" onClick={() => open(w)}
                      aria-label={"Рассмотреть " + w.title} aria-haspopup="dialog">
                      {w.title}
                    </button>
                  </h3>
                  <div className="card-bottom">
                    <span className={"card-price" + (catalogPrice(w) === null ? " on-request" : "")}>{catalogMoney(w)}</span>
                    {!canEdit && (
                      <button
                        type="button"
                        className={"favorite-toggle" + (favoriteIds.has(w.id) ? " is-favorite" : "")}
                        onClick={() => void toggleFavorite(w)}
                        disabled={favoriteBusy !== null}
                        aria-label={favoriteIds.has(w.id) ? `Убрать «${w.title}» из избранного` : `Добавить «${w.title}» в избранное`}
                        aria-pressed={favoriteIds.has(w.id)}
                        title={favoriteIds.has(w.id) ? "Убрать из избранного" : "В избранное"}
                      >
                        <Heart size={20} fill={favoriteIds.has(w.id) ? "currentColor" : "none"} />
                      </button>
                    )}
                  </div>
                  {canEdit && (
                    <button className="edit-card" onClick={() => setEditing(w)}>
                      Редактировать работу <Settings2 size={14} />
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        {filtered.length > limit && (
          <button
            className="button secondary more"
            onClick={() => setLimit((n) => n + 24)}
          >
            Показать ещё {Math.min(24, filtered.length - limit)} работ{" "}
            <ChevronDown size={17} />
          </button>
        )}
          <div className="collection-note" data-reveal>
            <Sparkles size={24} />
            <p>
              Двух одинаковых историй не бывает. Ручная роспись делает каждую
              работу особенной.
            </p>
          </div>
      </main>
        <section id="story" className="story">
          <div className="story-top" data-reveal>
            <div className="eyebrow">02 / ТЕПЛО РУЧНОЙ РАБОТЫ</div>
            <span>Маленькая мастерская. Свой большой мир.</span>
          </div>
          <div className="story-layout">
            <div className="story-picture" data-reveal>
              <div className="story-image-wrap">
                <CatalogImage
                  src={imageUrl("images/Master.webp")}
                  alt="Мастер за работой"
                  loading="lazy"
                />
              </div>
              <span className="story-image-note">
                Немного цвета — и появляется характер.
              </span>
              <Flower2
                className="story-flower"
                size={96}
                strokeWidth={0.8}
                aria-hidden="true"
              />
            </div>
            <div className="story-copy" data-reveal>
              <h2>
                Не просто декор.
                <br />
                <em>Маленькое чувство.</em>
              </h2>
              <p>
                Небольшие вещи, в которых остаётся тепло рук. Гипс, кисти,
                немного цвета — и простая фигурка обретает свой характер.
              </p>
              <p>
                Для полки, на которой не хватало чего-то особенного. Для подарка
                человеку, которого хочется порадовать. Или просто — для себя.
              </p>
              <div className="story-tags">
                <span>Ручная роспись</span>
                <span>Ваше настроение</span>
                <span>Живые детали</span>
              </div>
              <MasterContacts settings={settings} showEmpty />
            </div>
          </div>
          <div className="story-signature" aria-hidden="true">
            сделано с душой<span>✧</span>
          </div>
        </section>

      <footer>
        <a className="footer-brand" href="#">
          <Flower2 size={23} />
          {settings.name}
        </a>
        <span>Маленькие вещи. Большое тепло.</span>
        <div className="footer-controls">
          <button
            className="motion-toggle"
            onClick={() => setMotionPaused((v) => !v)}
            aria-pressed={motionPaused}
          >
            {motionPaused ? <Play size={12} /> : <Pause size={12} />}Анимации:{" "}
            {motionPaused ? "выкл" : "вкл"}
          </button>
          <small>
            <LockKeyhole size={12} />
            Приватный просмотр
          </small>
        </div>
      </footer>
      </>}
      {favoriteNotice && !selected ? (
        <div className={"toast" + (favoriteNotice.error ? " toast-error" : "")} role={favoriteNotice.error ? "alert" : "status"}>
          {!favoriteNotice.error && <Check size={19} />}
          {favoriteNotice.message}
        </div>
      ) : notice && !selected && (
        <div className="toast" role="status">
          <Check size={19} />
          {notice}
        </div>
      )}
      {selected && (
        <Modal title={selected.title} onClose={closeWork} wide>
          <div className="detail">
            <div className="gallery">
              <div className="gallery-main">
                {selectedPhotos[photoIndex] ? (
                  <button
                    type="button"
                    className="gallery-expand"
                    onClick={() => setLightboxOpen(true)}
                    aria-label="Открыть фото на весь экран"
                  >
                    <CatalogImage
                      key={selected.id + "-" + photoIndex + "-" + (selectedVariant?.id ?? "")}
                      src={imageUrl(selectedPhotos[photoIndex].url)}
                      alt={selectedPhotos[photoIndex].alt || selectedVariant?.name || selected.title}
                    />
                    <span className="gallery-expand-hint" aria-hidden="true"><Maximize2 size={18} /></span>
                  </button>
                ) : (
                  <div className="photo-placeholder"><ImagePlus /><span>Фотографии пока не добавлены</span></div>
                )}
                {selectedPhotos.length > 1 && (
                  <>
                    <button
                      className="gallery-arrow prev"
                      onClick={() => moveCatalogPhoto(-1)}
                      aria-label="Предыдущее фото"
                    >
                      <ArrowLeft size={20} />
                    </button>
                    <button
                      className="gallery-arrow next"
                      onClick={() => moveCatalogPhoto(1)}
                      aria-label="Следующее фото"
                    >
                      <ArrowRight size={20} />
                    </button>
                  </>
                )}
                {selectedPhotos.length > 0 && <span className="gallery-count">
                  {photoIndex + 1} / {selectedPhotos.length}
                </span>}
              </div>
              {selectedPhotos.length > 1 && (
                <div className="thumbnails">
                  {selectedPhotos.map((p, i) => (
                    <button
                      key={p.url + i}
                      className={photoIndex === i ? "selected" : ""}
                      onClick={() => selectCatalogPhoto(i)}
                      aria-label={"Фото " + (i + 1)}
                    >
                      <CatalogImage src={imageUrl(p.url)} alt="" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            {lightboxOpen && lightboxPhotos.length > 0 && (
              <Suspense fallback={null}><PhotoLightbox
                title={selectedVariant?.name ?? selected.title}
                photos={lightboxPhotos}
                initialIndex={photoIndex}
                onClose={() => setLightboxOpen(false)}
              /></Suspense>
            )}
            <div className="detail-copy">
              <div className="eyebrow">{selectedVariant ? selected.title : selected.category}</div>
              <h2>{selectedVariant?.name ?? selected.title}</h2>
              {!collectionOverview && <span className="availability">
                <span />
                {labels[selectedVariant?.availability ?? selected.availability]}
              </span>}
              <p>{selectedVariant?.description || selected.description}</p>
              {selected.variants.length > 0 && (
                <section className="variant-picker" aria-label="Выбор фигурки">
                  <h3>Выберите фигурку</h3>
                  <div className="variant-options">
                    <button type="button" className={!selectedVariant ? "selected" : ""} aria-pressed={!selectedVariant}
                      onClick={() => selectVariant(null)}>
                      {selected.photos[0] ? <CatalogImage src={imageUrl(selected.photos[0].url)} alt="" /> : <ImagePlus size={18} />}
                      <span>{selected.title}</span>
                      <small>{selected.soldAsSet ? money(selected.price) : "Фигурки по отдельности"}</small>
                    </button>
                    {selected.variants.map((variant) => (
                      <button
                        key={variant.id}
                        type="button"
                        className={selectedVariantId === variant.id ? "selected" : ""}
                        aria-pressed={selectedVariantId === variant.id}
                        onClick={() => selectVariant(variant.id)}
                      >
                        {variant.imageUrl ? <CatalogImage src={imageUrl(variant.imageUrl)} alt="" /> : <ImagePlus size={18} />}
                        <span>{variant.name}</span>
                        <small>{labels[variant.availability]} · {money(variant.price)}</small>
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {selectedMeasurements && <SizeDiagram value={selectedMeasurements} />}
              <dl>
                {selected.material && (
                  <>
                    <dt>Материал</dt>
                    <dd>{selected.material}</dd>
                  </>
                )}
                {!selectedVariant && !collectionOverview && !selectedMeasurements && selected.dimensions && (
                  <>
                    <dt>Размеры</dt>
                    <dd>{selected.dimensions}</dd>
                  </>
                )}
                <dt>Исполнение</dt>
                <dd>Ручная работа</dd>
              </dl>
              {collectionOverview ? <p className="collection-selection-hint">Выберите фигурку, чтобы увидеть её фотографии, цену и размеры.</p>
                : <strong className="price">{money(selectedPrice)}{selectedVariant && <small> за штуку</small>}</strong>}
              {!canEdit && (
                <div className="favorite-detail-group">
                  <button
                    type="button"
                    className={"button secondary favorite-detail" + (favoriteIds.has(selected.id) ? " is-favorite" : "")}
                    onClick={() => void toggleFavorite(selected)}
                    disabled={favoriteBusy !== null}
                    aria-pressed={favoriteIds.has(selected.id)}
                  >
                    <Heart size={17} fill={favoriteIds.has(selected.id) ? "currentColor" : "none"} />
                    {favoriteIds.has(selected.id) ? "В избранном" : "В избранное"}
                  </button>
                  {favoriteNotice?.workId === selected.id && (
                    <p ref={favoriteFeedback}
                      className={favoriteNotice.error ? "form-error favorite-feedback" : "form-success favorite-feedback"}
                      role={favoriteNotice.error ? "alert" : "status"}>
                      {favoriteNotice.message}
                    </p>
                  )}
                </div>
              )}
              <MasterContacts settings={settings}>
                {!admin && <ProductChat key={selected.id} workId={selected.id} userId={userId} onLogin={() => setLoginOpen(true)} />}
              </MasterContacts>
              {canEdit && (
                <button
                  className="button secondary"
                  onClick={() => {
                    setEditing(selected);
                    setSelected(null);
                    setSelectedVariantId(null);
                    updateCatalogUrl(null, null, "replace");
                  }}
                >
                  Редактировать
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
      {canEdit && editing !== undefined && (
        <Suspense fallback={null}><WorkEditor
          work={editing}
          categories={categories}
          materials={[...new Set(works.map((item) => item.material).filter(Boolean))]}
          onClose={() => setEditing(undefined)}
          onSaved={saved}
          onDeleted={removeWork}
        /></Suspense>
      )}
      {canEdit && treeEditor && <TreeEditor works={works} ornaments={ornaments}
        onClose={() => setTreeEditor(false)}
        onSaved={(item) => setOrnaments((items) => [...items.filter((i) => i.id !== item.id), item].sort((a, b) => a.position - b.position))}
        onDeleted={(id) => setOrnaments((items) => items.filter((i) => i.id !== id))}
        onReordered={(ordered) => {
          const positions = new Map(ordered.map((item) => [item.id, item.position]));
          setOrnaments((items) => items.map((item) => positions.has(item.id) ? { ...item, position: positions.get(item.id)! } : item));
        }}
      />}
      {loginOpen && (
        <LoginEditor
          onClose={() => setLoginOpen(false)}
          onLoggedIn={async () => {
            setLoginOpen(false);
            setEditingEnabled(true);
            setScope("published");
            await load();
          }}
        />
      )}
      {userId && messagesOpen && <Modal title="Переписка с мастером" wide onClose={() => setMessagesOpen(false)}>
        <div className="customer-messages"><ChatInbox inbox={chatInbox} userId={userId} admin={false} requestedId={selectedThreadId} /></div>
      </Modal>}
      {accountOpen && (
        <Modal title="Личный кабинет" onClose={() => setAccountOpen(false)}>
          <div className="account-content">
            <p className="form-intro">{userEmail}</p>
            <h3>Понравившиеся работы</h3>
            {publicWorks.filter((work) => favoriteIds.has(work.id)).length ? (
              <div className="favorite-list">
                {publicWorks.filter((work) => favoriteIds.has(work.id)).map((work) => (
                  <article key={work.id}>
                    {work.photos[0] && <CatalogImage src={imageUrl(work.photos[0].url)} alt="" />}
                    <div><strong>{work.title}</strong><span>{catalogMoney(work)}</span></div>
                    <button type="button" onClick={() => { setAccountOpen(false); open(work); }}>Открыть</button>
                  </article>
                ))}
              </div>
            ) : <p className="form-intro">В избранном пока нет работ. Нажмите на сердечко в каталоге, чтобы сохранить понравившуюся.</p>}
          </div>
        </Modal>
      )}
      {admin && settingsSection && (
        <SettingsEditor
          settings={settings}
          section={settingsSection}
          onClose={() => setSettingsSection(null)}
          onSaved={(s) => {
            setSettings(s);
            setCategory("");
            void load();
            setSettingsSection(null);
            setNotice("Настройки сохранены");
          }}
        />
      )}
    </div>
  );
}
function TreeEditor({ works, ornaments, onClose, onSaved, onDeleted, onReordered }: {
  works: Work[]; ornaments: TreeOrnament[]; onClose: () => void;
  onSaved: (item: TreeOrnament) => void; onDeleted: (id: string) => void;
  onReordered: (items: TreeOrnament[]) => void;
}) {
  const [editing, setEditing] = useState<TreeOrnament | null>(null);
  const [title, setTitle] = useState("");
  const [workId, setWorkId] = useState("");
  const [image, setImage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState("");
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [pendingAction, setPendingAction] = useState<"close" | { item: TreeOrnament | null } | null>(null);
  const newId = useRef(crypto.randomUUID());
  const pending = useRef<{ blob: Blob; uploaded?: string } | null>(null);
  const localUrls = useRef(new Set<string>());
  const fileInput = useRef<HTMLInputElement>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const cancelRemove = useRef<HTMLButtonElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const sorting = useOrnamentSort(ornaments, busy || pendingAction !== null || confirmRemove, async (previous, ordered) => {
    const saved = await saveTreeOrnamentOrder(previous, ordered);
    onReordered(saved);
    setEditing((item) => item ? { ...item, position: saved.find((savedItem) => savedItem.id === item.id)!.position } : null);
  });
  const sortedOrnaments = sorting.sorted;
  const displayedIds = new Set(treeItems(works, ornaments).map((item) => item.id));
  const dirty = title !== (editing?.title ?? "") || workId !== (editing?.workId ?? "") || image !== (editing?.imageUrl ?? "");
  useEffect(() => () => {
    for (const url of localUrls.current) URL.revokeObjectURL(url);
  }, []);
  useEffect(() => {
    if (error) errorMessage.current?.focus();
  }, [error]);
  useEffect(() => {
    if (confirmRemove) cancelRemove.current?.focus();
  }, [confirmRemove]);
  function releasePreview(url: string) {
    if (localUrls.current.delete(url)) URL.revokeObjectURL(url);
  }
  function choose(item: TreeOrnament | null) {
    releasePreview(image);
    setEditing(item);
    setTitle(item?.title ?? "");
    setWorkId(item?.workId ?? "");
    setImage(item?.imageUrl ?? "");
    newId.current = crypto.randomUUID();
    pending.current = null;
    setFileName("");
    setConfirmRemove(false);
    setPendingAction(null);
    if (fileInput.current) fileInput.current.value = "";
    setError("");
    setMessage("");
    requestAnimationFrame(() => formHeading.current?.focus());
  }
  function requestSelect(item: TreeOrnament) {
    if (busy || pendingAction || sorting.saving || sorting.active) return;
    const nextItem = item.id === editing?.id ? null : item;
    if (dirty) setPendingAction({ item: nextItem });
    else choose(nextItem);
  }
  function requestClose() {
    if (sorting.cancel()) return;
    if (busy || sorting.saving) return;
    if (dirty) setPendingAction("close");
    else onClose();
  }
  function discardChanges() {
    if (pendingAction === "close") onClose();
    else if (pendingAction) choose(pendingAction.item);
  }
  async function prepare(file?: File) {
    if (!file || busy || pendingAction || sorting.saving || sorting.active) return;
    setBusy(true);
    setError("");
    setMessage("");
    setConfirmRemove(false);
    setProgress("Обрабатываем изображение…");
    try {
      if (file.type !== "image/webp") throw new Error("Выберите WebP с прозрачным фоном.");
      const blob = await compressPhoto(file);
      const url = URL.createObjectURL(blob);
      localUrls.current.add(url);
      releasePreview(image);
      pending.current = { blob };
      setImage(url);
      setFileName(file.name);
      if (!title.trim()) setTitle(file.name.replace(/\.webp$/i, "").slice(0, 120));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось обработать изображение");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || pendingAction || confirmRemove || sorting.saving || sorting.active) return;
    if (!image || !title.trim() || !works.some((work) => work.id === workId)) {
      setError("Добавьте изображение, название украшения и выберите работу из каталога.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    setProgress("Сохраняем украшение…");
    try {
      let imageUrl = image;
      if (pending.current) {
        if (pending.current.uploaded && !await renewUploadedPhoto(pending.current.uploaded)) pending.current.uploaded = undefined;
        if (!pending.current.uploaded) {
          const result = await uploadPhoto(pending.current.blob);
          pending.current.uploaded = result.url;
        }
        imageUrl = pending.current.uploaded;
      }
      const saved = await saveTreeOrnament({
        id: editing?.id ?? newId.current, title, imageUrl, workId,
        position: editing?.position ?? Math.max(-1, ...ornaments.map((i) => i.position)) + 1,
      });
      onSaved(saved);
      choose(null);
      setMessage(editing ? "Изменения сохранены." : "Украшение добавлено. Можно добавить следующее.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить украшение");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  async function remove(item: TreeOrnament) {
    if (busy || sorting.saving || sorting.active) return;
    setBusy(true);
    setError("");
    setMessage("");
    setProgress("Убираем украшение…");
    try {
      await deleteTreeOrnament(item.id);
      onDeleted(item.id);
      if (editing?.id === item.id) choose(null);
      setConfirmRemove(false);
      setMessage("Украшение убрано с ёлки. Работа осталась в каталоге.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось убрать украшение");
    } finally {
      setBusy(false);
      setProgress("");
    }
  }
  const linkedWork = works.find((w) => w.id === workId);
  const fieldsDisabled = busy || pendingAction !== null || sorting.saving || sorting.draggingId !== null;
  return (
    <>
    <Modal title="Управление украшениями" onClose={requestClose} wide>
      <div className="tree-manager">
        <p className="form-intro">Выберите украшение для редактирования или добавьте новое. Каждое украшение открывает связанную работу в каталоге.</p>
        <div className="tree-manager-layout">
          <section className="tree-library" aria-labelledby="tree-library-heading">
            <div className="tree-library-head">
              <h3 id="tree-library-heading">Украшения</h3>
            </div>
            <p className="hint" id="tree-sort-help">На ёлке {displayedIds.size} из 8. Перетаскивайте украшения за ручку, чтобы менять их порядок.</p>
            <span className="visually-hidden" id="tree-sort-keyboard">Для перемещения с клавиатуры нажмите Пробел на ручке, используйте стрелки, затем снова Пробел для сохранения. Escape — отмена.</span>
            {sorting.error && <p className="form-error" role="alert">{sorting.error}</p>}
            <p className="tree-sort-status" role="status" aria-live="polite">{sorting.saving && <Loader2 size={14} className="spin" />}{sorting.announcement}</p>
            {sortedOrnaments.length ? (
              <div className="tree-manager-list" ref={sorting.listRef} aria-label="Добавленные украшения" aria-busy={sorting.saving}
                onPointerMove={sorting.pointerMove} onPointerUp={sorting.pointerUp}
                onPointerCancel={() => sorting.cancel()} onLostPointerCapture={() => sorting.cancel()}>
                {sortedOrnaments.map((item) => {
                  const work = works.find((w) => w.id === item.workId);
                  const visible = displayedIds.has(item.id);
                  const eligible = work?.status === "published" && work.availability !== "sold";
                  return (
                    <div key={item.id} data-ornament-id={item.id} className={"tree-sortable-item" + (sorting.draggingId === item.id ? " is-dragging" : "")}>
                    <button type="button" className="tree-drag-handle"
                      aria-label={`Изменить порядок: ${item.title}`} aria-describedby="tree-sort-help tree-sort-keyboard"
                      title="Перетащить украшение" disabled={busy || pendingAction !== null || confirmRemove || sorting.saving || sortedOrnaments.length < 2 || (sorting.draggingId !== null && sorting.draggingId !== item.id)}
                      onPointerDown={(e) => sorting.pointerDown(e, item.id)}
                      onKeyDown={(e) => sorting.keyDown(e, item.id)} onClick={(e) => e.preventDefault()}>
                      <GripVertical size={18} />
                    </button>
                    <button type="button" className="tree-manager-item"
                      aria-pressed={editing?.id === item.id} disabled={fieldsDisabled}
                      title={editing?.id === item.id ? "Снять выбор и перейти к добавлению" : "Редактировать украшение"}
                      onClick={() => requestSelect(item)}>
                      <span className="tree-item-image"><CatalogImage src={imageUrl(item.imageUrl)} alt="" loading="lazy" draggable={false} /></span>
                      <strong>{item.title}</strong>
                      <span className="tree-item-work" title={work?.title}>{work?.title ?? "Работа недоступна"}</span>
                      <span className={"tree-item-status" + (visible ? " is-visible" : "")}>{visible ? "На ёлке" : eligible ? "В очереди" : "Скрыто"}</span>
                    </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="tree-library-empty"><Sparkles size={28} /><strong>Пока нет украшений</strong><p>Добавьте первое с помощью формы.</p></div>
            )}
          </section>
          <form className="editor-form tree-ornament-form" onSubmit={submit} aria-busy={busy}>
            <h3 ref={formHeading} tabIndex={-1}>{editing ? "Редактировать украшение" : "Новое украшение"}</h3>
            {error && <p className="form-error" ref={errorMessage} tabIndex={-1} role="alert">{error}</p>}
            {message && <p className="tree-success" role="status"><Check size={16} />{message}</p>}
            <div className="tree-upload-field">
              <span className="tree-field-label" id="tree-image-label">Изображение украшения *</span>
              <input ref={fileInput} type="file" accept="image/webp" className="visually-hidden" tabIndex={-1}
                aria-labelledby="tree-image-label" disabled={fieldsDisabled} onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  e.currentTarget.value = "";
                  void prepare(file);
                }} />
              <button type="button" className={"tree-upload" + (dragOver ? " is-drag-over" : "")}
                disabled={fieldsDisabled} onClick={() => fileInput.current?.click()}
                aria-label={image ? "Заменить изображение украшения" : "Выбрать изображение украшения"}
                onDragOver={(e) => { e.preventDefault(); if (!fieldsDisabled) { e.dataTransfer.dropEffect = "copy"; setDragOver(true); } }}
                onDragLeave={(e) => { if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (fieldsDisabled) return;
                  if (e.dataTransfer.files.length !== 1) { setError("Выберите одно изображение украшения."); return; }
                  void prepare(e.dataTransfer.files[0]);
                }}>
                <span className="tree-upload-preview">{image ? <CatalogImage src={imageUrl(image)} alt="Предпросмотр украшения" /> : <ImagePlus size={30} />}</span>
                <span className="tree-upload-copy">
                  <span className="tree-upload-action"><Upload size={16} />{image ? "Заменить файл" : "Выбрать файл"}</span>
                  <span className="tree-upload-filename">{fileName || (image ? "Текущее изображение" : "или перетащите его сюда")}</span>
                  <span>WebP с прозрачным фоном · до 20 МБ</span>
                </span>
              </button>
              <p className="hint">Изображение загрузится после сохранения украшения.</p>
            </div>
            <label>Название украшения *<input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={120} disabled={fieldsDisabled} placeholder="Например, Снегурочка" /></label>
            <label>Работа в каталоге *<select required value={workId} onChange={(e) => setWorkId(e.target.value)} disabled={fieldsDisabled || !works.length}>
              <option value="" disabled>Выберите работу</option>
              {works.map((work) => <option key={work.id} value={work.id}>{work.title}{work.status !== "published" ? " (не опубликована)" : work.availability === "sold" ? " (продана)" : ""}</option>)}
            </select></label>
            {linkedWork && <div className="tree-link-preview">
              {linkedWork.photos[0] && <CatalogImage src={imageUrl(linkedWork.photos[0].url)} alt="" />}
              <span>При нажатии откроется:<strong>{linkedWork.title}</strong></span>
            </div>}
            {linkedWork && (linkedWork.status !== "published" || linkedWork.availability === "sold") && <p className="hint tree-visibility-note">Украшение скрыто, пока связанная работа не опубликована или отмечена как проданная.</p>}
            {!works.length && <p className="hint tree-visibility-note">Сначала добавьте работу в каталог, затем свяжите с ней украшение.</p>}
            {confirmRemove && editing && <div className="tree-confirm" role="alert">
              <strong>Убрать «{editing.title}» с ёлки?</strong>
              <p>Работа останется в каталоге.</p>
              <div>
                <button ref={cancelRemove} type="button" className="button secondary" disabled={busy} onClick={() => setConfirmRemove(false)}>Отмена</button>
                <button type="button" className="button danger" disabled={busy} onClick={() => void remove(editing)}>Убрать с ёлки</button>
              </div>
            </div>}
            {busy && <p className="tree-progress" role="status"><Loader2 size={16} className="spin" />{progress || "Сохраняем…"}</p>}
            <div className="form-footer">
              <button type="button" className="button secondary" disabled={busy || sorting.saving} onClick={requestClose}>Закрыть</button>
              <button className="button primary" disabled={fieldsDisabled || confirmRemove || !works.length || !image || !title.trim() || !linkedWork || (editing !== null && !dirty)}>
                <Check size={16} />{editing ? "Сохранить изменения" : "Добавить на ёлку"}
              </button>
            </div>
            {editing && <button type="button" className="tree-remove-button" disabled={fieldsDisabled || confirmRemove} onClick={() => setConfirmRemove(true)}><Trash2 size={15} />Убрать с ёлки</button>}
          </form>
        </div>
      </div>
    </Modal>
    {pendingAction && <UnsavedChangesDialog
      onContinue={() => setPendingAction(null)}
      onDiscard={discardChanges}
      {...(pendingAction === "close" ? {} : pendingAction.item ? {
        title: "Перейти без сохранения?",
        message: "Есть несохранённые изменения. При переходе к другому украшению они будут потеряны.",
        discardLabel: "Перейти без сохранения",
      } : {
        title: "Начать без сохранения?",
        message: "Есть несохранённые изменения. При добавлении нового украшения текущие изменения будут потеряны.",
        discardLabel: "Начать без сохранения",
      })}
    />}
    </>
  );
}

function SettingsEditor({
  settings,
  section,
  onClose,
  onSaved,
  embedded = false,
}: {
  settings: Settings;
  section: "general" | "categories";
  onClose: () => void;
  onSaved: (s: Settings) => void;
  embedded?: boolean;
}) {
  const [name, setName] = useState(settings.name),
    [contact, setContact] = useState(settings.contact),
    [vk, setVk] = useState(settings.vk),
    [telegram, setTelegram] = useState(settings.telegram),
    [phone, setPhone] = useState(settings.phone),
    [categories, setCategories] = useState<CategoryDraft[]>(settings.categories.map((name) => ({ key: crypto.randomUUID(), original: name, name }))),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryDrag, setCategoryDrag] = useState<{ key: string; startY: number; delta: number; from: number; to: number; step: number } | null>(null);
  const categoryList = useRef<HTMLDivElement>(null);
  function commitCategory() {
    const name = categoryName.trim();
    if (!name) { setError("Введите название категории."); return false; }
    if (categories.some((category) => category.key !== editingCategory && category.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setError("Такая категория уже есть."); return false;
    }
    setCategories((items) => items.map((item) => item.key === editingCategory ? { ...item, name } : item));
    setEditingCategory(null);
    setError("");
    return true;
  }
  function moveCategory(key: string, target: number) {
    setCategories((items) => {
      const next = [...items];
      const index = next.findIndex((item) => item.key === key);
      if (index < 0 || target < 0 || target >= next.length) return items;
      next.splice(target, 0, ...next.splice(index, 1));
      return next;
    });
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (editingCategory && !commitCategory()) return;
    const finalCategories = editingCategory
      ? categories.map((item) => item.key === editingCategory ? { ...item, name: categoryName.trim() } : item)
      : categories;
    setBusy(true);
    setError("");
    try {
      let savedSettings: Settings;
      if (section === "categories") {
        const saved = await saveCategories(finalCategories, settings.categoryRevision);
        savedSettings = { ...settings, categories: saved.names, categoryRevision: saved.revision };
      } else {
        savedSettings = await saveSettings({
          name,
          contact,
          vk,
          telegram,
          phone,
          categories: settings.categories,
          categoryRevision: settings.categoryRevision,
        });
      }
      onSaved(savedSettings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }
  const form = (
      <form className="editor-form" onSubmit={submit}>
        {section === "general" ? (
          <>
            <label htmlFor="site-name">
              Название мастерской
              <input
                id="site-name"
                value={name}
                required
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </label>
            <label htmlFor="site-instagram">
              Instagram
              <input
                id="site-instagram"
                type="url"
                maxLength={300}
                placeholder="https://www.instagram.com/имя"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                disabled={busy}
              />
            </label>
            <label htmlFor="site-vk">
              ВКонтакте
              <input id="site-vk" type="url" maxLength={300} placeholder="https://vk.com/имя" value={vk} onChange={(e) => setVk(e.target.value)} disabled={busy} />
            </label>
            <label htmlFor="site-telegram">
              Telegram
              <input id="site-telegram" type="url" maxLength={300} placeholder="https://t.me/имя" value={telegram} onChange={(e) => setTelegram(e.target.value)} disabled={busy} />
            </label>
            <label htmlFor="site-phone">
              Номер телефона
              <input id="site-phone" type="tel" autoComplete="tel" maxLength={40} placeholder="+7 (999) 123-45-67" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={busy} />
            </label>
            <p className="hint">
              Все контакты необязательные. Укажите полные ссылки на социальные сети. Заполненные контакты появятся в карточках работ и разделе «О мастерской».
            </p>
          </>
        ) : (
          <>
            <p className="form-intro">Нажмите на название, чтобы изменить его. Перетаскивайте категории, чтобы задать порядок на сайте.</p>
            <div className={`category-manager${categoryDrag ? " is-sorting" : ""}`} aria-label="Категории каталога" ref={categoryList}>
              {categories.map((item, index) => (
                <div className={`category-chip${categoryDrag?.key === item.key ? " dragging" : ""}${editingCategory === item.key ? " editing" : ""}`} key={item.key}
                  style={{ transform: categoryDrag ? `translateY(${categoryDrag.key === item.key ? categoryDrag.delta : index > categoryDrag.from && index <= categoryDrag.to ? -categoryDrag.step : index < categoryDrag.from && index >= categoryDrag.to ? categoryDrag.step : 0}px)` : undefined }}>
                  <button type="button" className="category-grip" aria-label={`Перетащить категорию «${item.name}»`} disabled={busy || !!editingCategory || categories.length < 2}
                    onPointerDown={(event) => {
                      if (event.button !== 0) return;
                      const row = event.currentTarget.closest<HTMLElement>(".category-chip");
                      if (!row || !categoryList.current) return;
                      event.preventDefault();
                      event.currentTarget.setPointerCapture(event.pointerId);
                      const gap = parseFloat(getComputedStyle(categoryList.current).gap) || 0;
                      setCategoryDrag({ key: item.key, startY: event.clientY, delta: 0, from: index, to: index, step: row.offsetHeight + gap });
                    }}
                    onPointerMove={(event) => {
                      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                      setCategoryDrag((drag) => {
                        if (!drag) return null;
                        const delta = Math.max(-drag.from * drag.step, Math.min((categories.length - 1 - drag.from) * drag.step, event.clientY - drag.startY));
                        return { ...drag, delta, to: Math.max(0, Math.min(categories.length - 1, drag.from + Math.round(delta / drag.step))) };
                      });
                    }}
                    onPointerUp={(event) => {
                      if (categoryDrag) moveCategory(categoryDrag.key, categoryDrag.to);
                      setCategoryDrag(null);
                      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                    }}
                    onPointerCancel={() => setCategoryDrag(null)}
                    onLostPointerCapture={() => setCategoryDrag(null)}
                    onKeyDown={(event) => { if (event.key === "Escape") setCategoryDrag(null); }}
                  ><GripVertical size={16} /></button>
                  {editingCategory === item.key ? (
                    <input className="category-inline-input" autoFocus aria-label="Название категории" maxLength={80} value={categoryName}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) => setCategoryName(event.target.value)}
                      onBlur={() => { commitCategory(); }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") { event.preventDefault(); commitCategory(); }
                        if (event.key === "Escape") {
                          event.preventDefault(); event.stopPropagation();
                          if (!item.name) setCategories((items) => items.filter((category) => category.key !== item.key));
                          setEditingCategory(null); setError("");
                        }
                      }} disabled={busy} placeholder="Название категории" />
                  ) : <button type="button" className="category-chip-name" disabled={busy || !!categoryDrag} onClick={() => { if (editingCategory && !commitCategory()) return; setEditingCategory(item.key); setCategoryName(item.name); }}>{item.name || "Новая категория"}</button>}
                  <div className="category-chip-actions">
                    <button type="button" className="category-remove" disabled={busy || !!categoryDrag} aria-label={`Удалить категорию «${item.name}»`} onClick={() => { setCategories((items) => items.filter((category) => category.key !== item.key)); if (editingCategory === item.key) setEditingCategory(null); }}><X size={15} /></button>
                  </div>
                </div>
              ))}
              <button type="button" className="category-add" disabled={busy || !!categoryDrag} aria-label="Добавить категорию" onClick={() => {
                if (editingCategory && !commitCategory()) return;
                const key = crypto.randomUUID();
                setCategories((items) => [...items, { key, original: null, name: "" }]);
                setEditingCategory(key); setCategoryName("");
              }}><Plus size={22} /></button>
            </div>
            <p className="hint category-manager-hint">{categories.length === 0 ? "Пока нет категорий. Нажмите +, чтобы добавить первую. " : ""}Изменения применятся после сохранения. При удалении категории её работы останутся в каталоге без категории.</p>
          </>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-footer">
          {!embedded && <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Отмена
          </button>}
          <button className="button primary" disabled={busy}>
            {busy ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
      </form>
  );
  return embedded ? form : (
    <Modal
      title={section === "categories" ? "Категории каталога" : "Настройки сайта"}
      onClose={() => { if (!busy) onClose(); }}
    >
      {form}
    </Modal>
  );
}
function LoginEditor({
  onClose,
  onLoggedIn,
}: {
  onClose: () => void;
  onLoggedIn: () => Promise<void>;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [registration, setRegistration] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (registration) {
        const result = await signUp(email, password);
        if (result.session) await onLoggedIn();
        else setMessage("Проверьте почту: мы отправили ссылку для подтверждения регистрации.");
      } else {
        await signIn(email, password);
        await onLoggedIn();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось войти");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={registration ? "Регистрация" : "Вход"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="editor-form" onSubmit={submit}>
        <p className="form-intro">
          {registration ? "Создайте аккаунт, чтобы сохранять понравившиеся работы." : "Введите email и пароль своего аккаунта."}
        </p>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          Пароль
          <input
            type="password"
            autoComplete="current-password"
            minLength={6}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {message && <p className="form-success" role="status">{message}</p>}
        <div className="form-footer">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Отмена
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? (registration ? "Создаём аккаунт…" : "Входим…") : registration ? "Зарегистрироваться" : "Войти"}
          </button>
        </div>
        <button
          type="button"
          className="auth-switch"
          disabled={busy}
          onClick={() => { setRegistration((value) => !value); setError(""); setMessage(""); }}
        >
          {registration ? "Уже есть аккаунт? Войти" : "Нет аккаунта? Зарегистрироваться"}
        </button>
      </form>
    </Modal>
  );
}
