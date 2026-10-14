import { useEffect, useRef, useState, type PointerEvent } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Pause, Play, Sparkles, Flower2, Heart, Gift } from "lucide-react";
import { visibleWorks, type Work } from "../lib/model";
import "./tree-hero.css";
import { treeItems, type TreeOrnament } from "./tree-items";

const TAU = Math.PI * 2;
const assetUrl = (url: string) => new URL(url, `${window.location.origin}${import.meta.env.BASE_URL}`).href;

export function TreeHero({ works, ornaments, ready, onOpen, stopMotion }: {
  works: Work[]; ornaments: TreeOrnament[]; ready: boolean; onOpen: (work: Work) => void; stopMotion: boolean;
}) {
  const published = visibleWorks(works);
  const selected = treeItems(works, ornaments);
  // Until cutouts are added, present real catalogue photographs in small frames.
  const items = selected.length ? selected.map((item) => ({ ...item, framed: false }))
    : published.filter((w) => w.featured && w.photos.length).slice(0, 8).map((work) => ({ id: work.id, title: work.title, imageUrl: work.photos[0].url, work, framed: true }));
  const [angle, setAngle] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(true);
  const [engaged, setEngaged] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [focused, setFocused] = useState(false);
  const drag = useRef<{ x: number; lastX: number; moved: boolean; workId?: string; pointerId: number } | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (paused || reduced || engaged || focused || dragging || stopMotion) return;
    let id = 0, last = 0;
    const frame = (now: number) => {
      if (last && !document.hidden) setAngle((a) => (a + Math.min(now - last, 50) * 0.00012) % TAU);
      last = now;
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [paused, reduced, engaged, focused, dragging, stopMotion]);
  const turn = (direction: number) => {
    setPaused(true);
    setAngle((a) => a + direction * TAU / Math.max(items.length, 6));
  };
  function pointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!e.isPrimary || e.button !== 0) return;
    const button = (e.target as HTMLElement).closest<HTMLElement>("[data-work]");
    drag.current = { x: e.clientX, lastX: e.clientX, moved: false, workId: button?.dataset.work, pointerId: e.pointerId };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function pointerMove(e: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== e.pointerId) return;
    if (Math.abs(e.clientX - current.x) > 7) current.moved = true;
    if (current.moved) {
      const delta = (e.clientX - current.lastX) * 0.009;
      setAngle((a) => a + delta);
      setPaused(true);
    }
    current.lastX = e.clientX;
  }
  function pointerUp(e: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (e.type === "pointerup" && !current.moved && current.workId && ready) {
      const work = items.find((w) => w.id === current.workId);
      if (work) onOpen(work.work);
    }
  }
  const count = Math.max(items.length, 5);
  return <>
    <section className="winter-hero" aria-label="Авторские украшения ручной работы">
      <div className="winter-dust" aria-hidden="true">{Array.from({ length: 22 }, (_, i) => <i key={i} style={{ left: `${(i * 43 + 7) % 100}%`, top: `${(i * 31 + 12) % 100}%`, animationDelay: `${i * -.7}s` }} />)}</div>
      <div className="winter-copy">
        <div className="winter-eyebrow"><Sparkles size={16} /> МАЛЕНЬКОЕ НОВОГОДНЕЕ ЧУДО <span /></div>
        <h1>Волшебные<br />украшения,<br /><em>в которых живёт</em><br /><span>тепло.</span></h1>
        <p>Авторские ёлочные игрушки ручной работы.<br />Немного волшебства. Много души.<br />И особая история для вашего дома.</p>
        <a className="winter-cta" href="#catalog">Выбрать украшения <span><ArrowUpRight size={23} /></span></a>
        <div className="winter-signature"><span /> Ручная работа <b>·</b> Уникальный дизайн <b>·</b> С любовью к деталям</div>
      </div>
      <div className="winter-tree-area">
        <div className={`winter-stage${dragging ? " is-dragging" : ""}`} tabIndex={0} role="group" aria-label="Вращающаяся ёлка с работами. Перетаскивайте или используйте стрелки на клавиатуре."
          onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}
          onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
          onPointerEnter={() => setEngaged(true)} onPointerLeave={() => setEngaged(false)}
          onFocusCapture={() => setFocused(true)} onBlurCapture={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocused(false); }}
          onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); turn(e.key === "ArrowLeft" ? -1 : 1); } }}>
          <div className="tree-halo" aria-hidden="true" />
          <svg className="ribbon-tree" viewBox="0 0 700 640" aria-hidden="true">
            <defs>
              <linearGradient id="ribbon-gold" x1="0" y1="0" x2="1" y2=".6"><stop stopColor="#71452f" /><stop offset=".25" stopColor="#e4af72" /><stop offset=".48" stopColor="#fff1cb" /><stop offset=".65" stopColor="#c88c53" /><stop offset="1" stopColor="#704334" /></linearGradient>
              <linearGradient id="ribbon-rose"><stop stopColor="#654053" /><stop offset=".5" stopColor="#e4b4c4" /><stop offset="1" stopColor="#89566a" /></linearGradient>
              <filter id="gold-glow"><feGaussianBlur stdDeviation="3" /></filter>
            </defs>
            <path d="M350 48 C330 190 295 320 260 558 L440 558 C405 320 370 190 350 48" fill="url(#ribbon-gold)" opacity=".035" />
            {[0, 1, 2, 3, 4].map((i) => {
              const y = 135 + i * 91, rx = 63 + i * 49;
              return <g key={i} transform={`translate(350 ${y}) rotate(${Math.sin(angle + i * .7) * 9})`}>
                <ellipse rx={rx} ry={17 + i * 7} fill="none" stroke="url(#ribbon-rose)" strokeWidth="13" opacity=".35" transform="rotate(-13)" />
                <ellipse rx={rx} ry={20 + i * 7} fill="none" stroke="url(#ribbon-gold)" strokeWidth="12" />
                <ellipse rx={rx} ry={20 + i * 7} fill="none" stroke="#ffe1a8" strokeWidth="1" transform="translate(0 -6)" opacity=".8" />
              </g>;
            })}
            <path d="M350 58 C330 125 440 160 420 218 S160 295 215 355 S625 425 550 500 S190 570 90 550" fill="none" stroke="url(#ribbon-gold)" strokeWidth="17" opacity=".85" />
            <path d="M350 58 C330 125 440 160 420 218 S160 295 215 355 S625 425 550 500 S190 570 90 550" fill="none" stroke="#ffe6b4" strokeWidth="1" />
            {Array.from({ length: 30 }, (_, i) => {
              const y = 115 + i * 15, phase = i * 2.4 + angle, width = 35 + i * 8;
              return <g key={i}><circle cx={350 + Math.sin(phase) * width} cy={y} r="5" fill="#ffc981" opacity=".5" filter="url(#gold-glow)" /><circle cx={350 + Math.sin(phase) * width} cy={y} r="1.7" fill="#fff0c5" /></g>;
            })}
          </svg>
          <div className="tree-star" aria-hidden="true">✧</div>
          {Array.from({ length: count }, (_, i) => {
            const work = items[i], phase = angle + i * TAU / count;
            const depth = Math.cos(phase), radius = 22 + (i % 3) * 5;
            const x = 50 + Math.sin(phase) * radius, y = 35 + (i % 3) * 13 + depth * 5;
            const style = { left: `${x}%`, top: `${y}%`, transform: `translate(-50%, -25%) scale(${.7 + (depth + 1) * .2})`, zIndex: Math.round(20 + depth * 10), opacity: .55 + (depth + 1) * .225 };
            return work ? <button key={work.id} data-work={work.id} className={`tree-toy${work.framed ? " tree-toy-framed" : ""}`} style={style} disabled={!ready} aria-label={`Рассмотреть: ${work.title}`} onClick={(e) => { if (e.detail === 0 && ready) onOpen(work.work); }}>
              <span className="toy-thread" aria-hidden="true" />
              <img draggable={false} src={assetUrl(work.imageUrl)} alt={work.title} />
              <span className="toy-title">{work.title} <ArrowUpRight size={13} /></span>
            </button> : <div key={`bauble-${i}`} className={`tree-bauble bauble-${i % 3}`} style={style} aria-hidden="true"><span className="toy-thread" /><span>✧</span></div>;
          })}
        </div>
        <div className="tree-controls">
          <button onClick={() => turn(-1)} aria-label="Повернуть ёлку влево"><ArrowLeft size={18} /></button>
          <span>{items.length ? "Поверните ёлку · выберите свою историю" : "Скоро здесь появятся новые истории"}</span>
          <button onClick={() => turn(1)} aria-label="Повернуть ёлку вправо"><ArrowRight size={18} /></button>
          <button onClick={() => setPaused((p) => !p)} disabled={reduced || stopMotion} aria-label={paused ? "Включить вращение" : "Остановить вращение"} aria-pressed={paused}>{paused || reduced || stopMotion ? <Play size={15} /> : <Pause size={15} />}</button>
        </div>
      </div>
    </section>
    <div className="winter-values"><div><Flower2 /><span>РУЧНАЯ РАБОТА<small>С ЛЮБОВЬЮ</small></span></div><div><Gift /><span>МАЛЕНЬКИЕ РАДОСТИ<small>БОЛЬШИЕ ЧУВСТВА</small></span></div><div><Heart /><span>ДЛЯ ВАШЕГО ДОМА<small>И ОСОБЫХ МОМЕНТОВ</small></span></div></div>
  </>;
}
