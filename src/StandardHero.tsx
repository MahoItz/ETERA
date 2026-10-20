import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Flower2 } from "lucide-react";
import { type Work } from "../lib/model";
import { CatalogImage } from "./CatalogImage";
import { HeroValues } from "./HeroValues";
import { imageUrl } from "./EditorUI";
import { carouselOffset, heroItems } from "./hero-items";
import "./standard-hero.css";

export function StandardHero({ works, ready, loading, onOpen, stopMotion }: {
  works: Work[]; ready: boolean; loading: boolean; onOpen: (work: Work) => void; stopMotion: boolean;
}) {
  const items = heroItems(works);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = Math.max(0, items.findIndex((item) => item.id === activeId));
  const [reduced, setReduced] = useState(true);
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const root = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number; id: number; swiping: boolean } | null>(null);
  const suppressClick = useRef(false);
  const count = items.length;
  const ids = items.map((item) => item.id).join(",");

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!root.current || !("IntersectionObserver" in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: .1 });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (count < 2 || !ready || reduced || stopMotion || !visible || hovered || focused) return;
    const orderedIds = ids.split(",");
    const timer = window.setInterval(() => {
      if (document.hidden || drag.current) return;
      setActiveId((current) => orderedIds[(Math.max(0, orderedIds.indexOf(current ?? "")) + 1) % orderedIds.length]);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [count, ids, ready, reduced, stopMotion, visible, hovered, focused]);

  function turn(direction: number) {
    if (count < 2) return;
    setActiveId(items[(active + direction + count) % count].id);
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClick.current = false;
    drag.current = { x: event.clientX, y: event.clientY, id: event.pointerId, swiping: false };
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!start.swiping && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { drag.current = null; return; }
    if (!start.swiping && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      start.swiping = true;
      suppressClick.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }
  function pointerEnd(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (event.type === "pointerup" && start.swiping && Math.abs(event.clientX - start.x) >= 30) turn(event.clientX < start.x ? 1 : -1);
  }

  return <>
    <section ref={root} className="standard-hero" aria-label="Авторский декор ручной работы"
      style={{ "--standard-hero-background": `url("${import.meta.env.BASE_URL}images/hero-standard-background.webp")` } as CSSProperties}>
      <div className="standard-hero-copy">
        <p className="standard-hero-eyebrow"><span aria-hidden="true" />Маленькая мастерская. Большие чувства.</p>
        <h1>Вещи, в которых<br /><em>живёт</em> <span>тепло.</span></h1>
        <p className="standard-hero-description">Немного гипса. Много фантазии.<br />И маленькая история для вашего дома.</p>
        <a className="standard-hero-cta" href="#catalog">Найти свою историю<span><ArrowUpRight size={22} /></span></a>
        <p className="standard-hero-note"><span aria-hidden="true" />Продумано. Стильно. Расписано вручную.</p>
      </div>
      <div className="standard-carousel" role="region" aria-roledescription="карусель" aria-label="Работы мастерской"
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        onFocusCapture={() => setFocused(true)} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); turn(event.key === "ArrowLeft" ? -1 : 1); }
        }}>
        <div id="standard-carousel-stage" className={`standard-carousel-stage${count < 3 ? " is-small" : ""}`} aria-busy={loading}
          onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}
          onLostPointerCapture={() => { drag.current = null; }}
          onClickCapture={(event) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}>
          {items.map((work, index) => {
            const offset = carouselOffset(index, active, count);
            const distance = Math.abs(offset);
            return <button key={work.id} type="button" className={`standard-hero-card${offset === 0 ? " is-active" : ""}`}
              hidden={distance > 2} disabled={!ready} tabIndex={distance > 2 ? -1 : 0}
              aria-label={`Рассмотреть: ${work.title}`} aria-current={offset === 0 ? "true" : undefined}
              style={{ "--card-offset": offset, "--card-distance": distance, zIndex: 5 - distance } as CSSProperties}
              onClick={() => onOpen(work)}>
              <div className="standard-card-photo"><CatalogImage src={imageUrl(work.photos[0].url)} alt={work.photos[0].alt || work.title} draggable={false} loading={distance > 1 ? "lazy" : "eager"} /></div>
              <span className="standard-card-caption"><Flower2 size={21} aria-hidden="true" /><span>{work.title}</span><ArrowUpRight size={22} aria-hidden="true" /></span>
            </button>;
          })}
          {!count && <div className="standard-carousel-empty" role="status"><Flower2 size={48} strokeWidth={1} aria-hidden="true" /><span>{loading ? "Знакомимся с работами…" : "Здесь начинается новая история"}</span><p>{loading ? "Совсем скоро покажем вам маленькие радости." : "Загляните в коллекцию — красота в деталях."}</p></div>}
        </div>
        {count > 1 && <>
          <button className="standard-carousel-arrow is-previous" type="button" onClick={() => turn(-1)} aria-label="Предыдущая работа" aria-controls="standard-carousel-stage"><ArrowLeft /></button>
          <button className="standard-carousel-arrow is-next" type="button" onClick={() => turn(1)} aria-label="Следующая работа" aria-controls="standard-carousel-stage"><ArrowRight /></button>
          <div className="standard-carousel-controls">
            <div className="standard-carousel-dots" role="group" aria-label="Выбрать карточку">
              {items.map((work, index) => <button key={work.id} type="button" onClick={() => setActiveId(work.id)} aria-label={`Карточка ${index + 1}: ${work.title}`} aria-pressed={active === index}><span /></button>)}
            </div>
          </div>
        </>}
        <span className="sr-only" aria-live={focused ? "polite" : "off"} aria-atomic="true">{count ? `${active + 1} из ${count}. ${items[active].title}` : ""}</span>
      </div>
    </section>
    <HeroValues />
  </>;
}
