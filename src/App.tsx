import { Modal, imageUrl, compressPhoto } from "./EditorUI";
import { PhotoLightbox } from "./PhotoLightbox";
import { WorkEditor } from "./WorkEditor";
import { TreeHero } from "./TreeHero";
import { treeItems, type TreeOrnament } from "./tree-items";
import { useOrnamentSort } from "./useOrnamentSort";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Flower2,
  GripVertical,
  ImagePlus,
  Maximize2,
  Eye,
  LogOut,
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
  visibleWorks,
  type Work,
  type Settings,
} from "../lib/model";
import {
  getAdminSession,
  loadCatalog,
  saveSettings,
  saveCategories,
  type CategoryDraft,
  signIn,
  signOut,
  uploadPhoto,
  saveTreeOrnament,
  saveTreeOrnamentOrder,
  deleteTreeOrnament,
  cleanUnusedTreeImage,
} from "./catalog";
const money = (n: number | null) =>
  n === null
    ? "Цена по запросу"
    : new Intl.NumberFormat("ru-RU").format(n) + " ₽";
const labels = { available: "В наличии", order: "Под заказ", sold: "Продано" };
function tilt(e: ReactPointerEvent<HTMLElement>) {
  if (
    e.currentTarget.closest(".motion-paused") ||
    e.pointerType === "touch" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return;
  const el = e.currentTarget,
    rect = el.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width - 0.5,
    y = (e.clientY - rect.top) / rect.height - 0.5;
  el.style.setProperty("--tilt-x", (-y * 5).toFixed(2) + "deg");
  el.style.setProperty("--tilt-y", (x * 6).toFixed(2) + "deg");
  el.style.setProperty("--move-x", (x * 14).toFixed(2) + "px");
  el.style.setProperty("--move-y", (y * 12).toFixed(2) + "px");
}
function resetTilt(e: ReactPointerEvent<HTMLElement>) {
  for (const name of ["--tilt-x", "--tilt-y", "--move-x", "--move-y"])
    e.currentTarget.style.removeProperty(name);
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
  const [motionPaused, setMotionPaused] = useState(false);
  const [ornaments, setOrnaments] = useState<TreeOrnament[]>([]);
  const [treeEditor, setTreeEditor] = useState(false);
  const [works, setWorks] = useState<Work[]>([]),
    [settings, setSettings] = useState<Settings>(defaults),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [admin, setAdmin] = useState(false),
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
  const canEdit = admin && editingEnabled;
  async function load() {
    setError("");
    setLoading(true);
    try {
      const [data, session] = await Promise.all([
        loadCatalog(),
        getAdminSession(),
      ]);
      setWorks(data.works);
      setOrnaments(data.ornaments);
      setSettings(data.settings);
      setAdmin(Boolean(session));
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
    setLimit(24);
  }, [query, category, sort, scope, canEdit]);
  useEffect(() => {
    if (!selected || lightboxOpen || selected.photos.length < 2) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") {
        setSelectedVariantId(null);
        setPhotoIndex((i) => (i + 1) % selected.photos.length);
      }
      if (e.key === "ArrowLeft") {
        setSelectedVariantId(null);
        setPhotoIndex(
          (i) => (i + selected.photos.length - 1) % selected.photos.length,
        );
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selected, lightboxOpen]);
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
  }, [loading, canEdit, query, category, sort, scope, limit, motionPaused]);
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
  const selectedVariant = selected?.variants.find((variant) => variant.id === selectedVariantId) ?? null;
  const lightboxPhotos = [...(selected?.photos ?? [])];
  for (const variant of selected?.variants ?? []) {
    if (variant.imageUrl && !lightboxPhotos.some((photo) => photo.url === variant.imageUrl)) {
      lightboxPhotos.push({ url: variant.imageUrl, alt: variant.name });
    }
  }
  function open(w: Work) {
    setLightboxOpen(false);
    setSelected(w);
    setPhotoIndex(0);
    setSelectedVariantId(null);
  }
  function selectCatalogPhoto(index: number) {
    setSelectedVariantId(null);
    setPhotoIndex(index);
  }
  function moveCatalogPhoto(direction: 1 | -1) {
    if (!selected) return;
    setSelectedVariantId(null);
    setPhotoIndex((index) =>
      (index + selected.photos.length + direction) % selected.photos.length,
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
    setSelected((item) => item?.id === work.id ? null : item);
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
    setSelected(null);
    if (accountMenu.current) accountMenu.current.open = false;
  }
  async function logout() {
    setSigningOut(true);
    setAccountError("");
    try {
      await signOut();
      setAdmin(false);
      setEditingEnabled(true);
      setWorks((items) => visibleWorks(items));
      setSelected(null);
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
  return (
    <div
      ref={motionRoot}
      className={"studio-shell" + (motionPaused ? " motion-paused" : "")}
    >
      <header className="header">
        <a className="brand" href="#">
          <span className="brand-symbol">
            <Flower2 size={26} />
          </span>
          <span>
            {settings.name}
            <small>ДЕКОР С ХАРАКТЕРОМ</small>
          </span>
        </a>
        <nav>
          <a href="#catalog">Коллекция</a>
          <a href="#story">О мастерской</a>
        </nav>
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
                  setSettingsSection("general");
                  if (accountMenu.current) accountMenu.current.open = false;
                }}
              >
                <Settings2 size={16} />Настройки сайта
              </button>
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
      </header>
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
                style={{ transitionDelay: Math.min(i % 3, 2) * 70 + "ms" }}
                onPointerMove={tilt}
                onPointerLeave={resetTilt}
              >
                <span className="card-number" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <button
                  className="card-photo"
                  onClick={() => open(w)}
                  aria-label={"Рассмотреть " + w.title}
                >
                  {w.photos[0] ? (
                    <img
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
                      aria-label="Избранная работа"
                    >
                      <Star size={15} />
                    </span>
                  )}
                  <span className="photo-open">
                    <ArrowUpRight size={23} />
                  </span>
                </button>
                <div className="card-info">
                  <span className="card-category">
                    {w.category} · {w.material || "Ручная работа"}
                  </span>
                  <button className="title-button" onClick={() => open(w)}>
                    <h3>{w.title}</h3>
                    <ArrowUpRight size={18} />
                  </button>
                  <div className="card-bottom">
                    <span>{money(w.price)}</span>
                    <span>{w.photos.length} фото</span>
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
                <img
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
              {settings.contact ? (
                <a
                  className="button primary"
                  href={settings.contact}
                  target="_blank"
                  rel="noreferrer"
                >
                  Обсудить свою историю <ArrowUpRight size={18} />
                </a>
              ) : (
                <p className="contact-unset">
                  Контакт мастера появится здесь после настройки.
                </p>
              )}
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
      {notice && (
        <div className="toast" role="status">
          <Check size={19} />
          {notice}
        </div>
      )}
      {selected && (
        <Modal title={selected.title} onClose={() => setSelected(null)} wide>
          <div className="detail">
            <div className="gallery">
              <div className="gallery-main">
                {selected.photos[photoIndex] ? (
                  <button
                    type="button"
                    className="gallery-expand"
                    onClick={() => setLightboxOpen(true)}
                    aria-label="Открыть фото на весь экран"
                  >
                    <img
                      key={selected.id + "-" + photoIndex + "-" + (selectedVariant?.id ?? "")}
                      src={imageUrl(selectedVariant?.imageUrl ?? selected.photos[photoIndex].url)}
                      alt={selectedVariant?.name || selected.photos[photoIndex].alt || selected.title}
                    />
                    <span className="gallery-expand-hint" aria-hidden="true"><Maximize2 size={18} /></span>
                  </button>
                ) : (
                  <ImagePlus />
                )}
                {selected.photos.length > 1 && (
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
                <span className="gallery-count">
                  {selected.photos.length ? photoIndex + 1 : 0} /{" "}
                  {selected.photos.length}
                </span>
              </div>
              {selected.photos.length > 1 && (
                <div className="thumbnails">
                  {selected.photos.map((p, i) => (
                    <button
                      key={p.url + i}
                      className={photoIndex === i ? "selected" : ""}
                      onClick={() => selectCatalogPhoto(i)}
                      aria-label={"Фото " + (i + 1)}
                    >
                      <img src={imageUrl(p.url)} alt="" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            {lightboxOpen && lightboxPhotos.length > 0 && (
              <PhotoLightbox
                title={selected.title}
                photos={lightboxPhotos}
                initialIndex={Math.max(0, lightboxPhotos.findIndex((photo) => photo.url === (selectedVariant?.imageUrl ?? selected.photos[photoIndex]?.url)))}
                onClose={() => setLightboxOpen(false)}
              />
            )}
            <div className="detail-copy">
              <div className="eyebrow">{selected.category}</div>
              <h2>{selected.title}</h2>
              <span className="availability">
                <span />
                {labels[selectedVariant?.availability ?? selected.availability]}
              </span>
              <p>{selected.description}</p>
              {selected.variants.length > 0 && (
                <section className="variant-picker" aria-label="Выбор фигурки">
                  <h3>Выберите фигурку</h3>
                  <div className="variant-options">
                    {selected.variants.map((variant) => (
                      <button
                        key={variant.id}
                        type="button"
                        className={selectedVariantId === variant.id ? "selected" : ""}
                        onClick={() => setSelectedVariantId(variant.id)}
                      >
                        {variant.imageUrl ? <img src={imageUrl(variant.imageUrl)} alt="" /> : <ImagePlus size={18} />}
                        <span>{variant.name}</span>
                        <small>{labels[variant.availability]}{variant.price !== null ? ` · ${money(variant.price)}` : ""}</small>
                      </button>
                    ))}
                  </div>
                </section>
              )}
              <dl>
                {selected.material && (
                  <>
                    <dt>Материал</dt>
                    <dd>{selected.material}</dd>
                  </>
                )}
                {selected.dimensions && (
                  <>
                    <dt>Размеры</dt>
                    <dd>{selected.dimensions}</dd>
                  </>
                )}
                <dt>Исполнение</dt>
                <dd>Ручная работа</dd>
              </dl>
              <strong className="price">{money(selectedVariant?.price ?? selected.price)}</strong>
              {settings.contact ? (
                <a
                  href={settings.contact}
                  target="_blank"
                  rel="noreferrer"
                  className="button primary"
                >
                  Обсудить с мастером <ArrowUpRight size={18} />
                </a>
              ) : (
                <p className="contact-unset">
                  Контакт можно добавить в настройках редактора.
                </p>
              )}
              {canEdit && (
                <button
                  className="button secondary"
                  onClick={() => {
                    setEditing(selected);
                    setSelected(null);
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
        <WorkEditor
          work={editing}
          categories={categories}
          materials={[...new Set(works.map((item) => item.material).filter(Boolean))]}
          onClose={() => setEditing(undefined)}
          onSaved={saved}
          onDeleted={removeWork}
        />
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
  const uploadedUrls = useRef(new Set<string>());
  const fileInput = useRef<HTMLInputElement>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
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
    for (const url of uploadedUrls.current) void cleanUnusedTreeImage(url).catch(() => {});
  }, []);
  useEffect(() => {
    if (pendingAction) keepEditing.current?.focus();
  }, [pendingAction]);
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
        if (!pending.current.uploaded) {
          const result = await uploadPhoto(pending.current.blob);
          pending.current.uploaded = result.url;
          uploadedUrls.current.add(result.url);
        }
        imageUrl = pending.current.uploaded;
      }
      const saved = await saveTreeOrnament({
        id: editing?.id ?? newId.current, title, imageUrl, workId,
        position: editing?.position ?? Math.max(-1, ...ornaments.map((i) => i.position)) + 1,
      });
      uploadedUrls.current.delete(imageUrl);
      onSaved(saved);
      if (editing && editing.imageUrl !== imageUrl) void cleanUnusedTreeImage(editing.imageUrl).catch(() => {});
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
      void cleanUnusedTreeImage(item.imageUrl).catch(() => {});
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
                      <span className="tree-item-image"><img src={imageUrl(item.imageUrl)} alt="" loading="lazy" draggable={false} /></span>
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
            {pendingAction && (
              <div className="tree-confirm" role="alert">
                <strong>Есть несохранённые изменения</strong>
                <p>{pendingAction === "close" ? "Закрыть окно без сохранения?" : pendingAction.item ? "Перейти к другому украшению без сохранения?" : "Начать новое украшение без сохранения текущих изменений?"}</p>
                <div>
                  <button ref={keepEditing} type="button" className="button secondary" onClick={() => setPendingAction(null)}>Продолжить редактирование</button>
                  <button type="button" className="button secondary" onClick={discardChanges}>Не сохранять</button>
                </div>
              </div>
            )}
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
                <span className="tree-upload-preview">{image ? <img src={imageUrl(image)} alt="Предпросмотр украшения" /> : <ImagePlus size={30} />}</span>
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
              {linkedWork.photos[0] && <img src={imageUrl(linkedWork.photos[0].url)} alt="" />}
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
  );
}

function SettingsEditor({
  settings,
  section,
  onClose,
  onSaved,
}: {
  settings: Settings;
  section: "general" | "categories";
  onClose: () => void;
  onSaved: (s: Settings) => void;
}) {
  const [name, setName] = useState(settings.name),
    [contact, setContact] = useState(settings.contact),
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
      onSaved(
        section === "categories" ? { ...settings, categories: await saveCategories(finalCategories) } : await saveSettings({
          name,
          contact,
          categories: settings.categories,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка сохранения");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={section === "categories" ? "Категории каталога" : "Настройки сайта"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="editor-form" onSubmit={submit}>
        {section === "general" ? (
          <>
            <label>
              Название мастерской
              <input
                value={name}
                required
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </label>
            <label>
              Ссылка для связи
              <input
                type="url"
                placeholder="https://t.me/имя"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                disabled={busy}
              />
            </label>
            <p className="hint">
              Telegram, VK или Instagram. Ссылка появится в карточках работ.
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
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Отмена
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
      </form>
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
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await signIn(email, password);
      await onLoggedIn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось войти");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Вход"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="editor-form" onSubmit={submit}>
        <p className="form-intro">
          Введите email и пароль своего аккаунта.
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
            {busy ? "Входим…" : "Войти"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
