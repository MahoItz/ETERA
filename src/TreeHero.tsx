import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { HeroValues } from "./HeroValues";
import { CatalogImage } from "./CatalogImage";
import { visibleWorks, type Work } from "../lib/model";
import "./tree-hero.css";
import { treeItems, type TreeOrnament } from "./tree-items";

const TAU = Math.PI * 2;
// Fixed random values keep ornaments in place while the tree rotates or React renders.
function ornamentNoise(index: number, seed: number) {
  let value = Math.imul(index + seed, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}
const assetUrl = (url: string) => new URL(url, `${window.location.origin}${import.meta.env.BASE_URL}`).href;
const treeLevels = [
  { y: 23, radius: 8, scale: .72 },
  { y: 31, radius: 11, scale: .8 },
  { y: 39, radius: 14, scale: .88 },
  { y: 48, radius: 17, scale: .96 },
  { y: 58, radius: 20, scale: 1.04 },
  { y: 67, radius: 22, scale: 1.09 },
  { y: 74, radius: 24, scale: 1.12 },
  { y: 81, radius: 26, scale: 1.14 },
] as const;
// Separate neighbouring heights around the tree so random positions cannot cluster.
const ornamentPhases = treeLevels.reduce<number[]>((phases, _, index) => {
  let phase = ornamentNoise(index, 37) * TAU;
  const previous = phases[index - 1];
  for (let attempt = 0; previous !== undefined && attempt < 32; attempt++) {
    const distance = Math.abs(Math.atan2(Math.sin(phase - previous), Math.cos(phase - previous)));
    if (distance >= 1.9) break;
    phase = ornamentNoise(index, 151 + attempt) * TAU;
  }
  phases.push(phase);
  return phases;
}, []);

export function TreeHero({ works, ornaments, ready, onOpen, stopMotion, editorActions }: {
  works: Work[]; ornaments: TreeOrnament[]; ready: boolean; onOpen: (work: Work) => void; stopMotion: boolean;
  editorActions?: ReactNode;
}) {
  const published = visibleWorks(works);
  const selected = treeItems(works, ornaments);
  // Until cutouts are added, present real catalogue photographs in small frames.
  const items = selected.length ? selected.map((item) => ({ ...item, framed: false }))
    : published.filter((w) => w.featured && w.photos.length).slice(0, 8).map((work) => ({ id: work.id, title: work.title, imageUrl: work.photos[0].url, work, framed: true }));
  const [angle, setAngle] = useState(0);
  const [reduced, setReduced] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [heroVisible, setHeroVisible] = useState(false);
  const hero = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number; lastX: number; moved: boolean; workId?: string; pointerId: number } | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const element = hero.current;
    if (!element || !("IntersectionObserver" in window)) {
      setHeroVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setHeroVisible(entry.isIntersecting), {
      threshold: 0.05,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (reduced || dragging || stopMotion || !heroVisible) return;
    let id = 0, last = 0, elapsed = 0;
    const frame = (now: number) => {
      if (last && !document.hidden) {
        const delta = Math.min(now - last, 50);
        elapsed += delta;
        // Ease back into automatic motion rather than starting at full speed.
        const step = delta * 0.00012 * Math.min(elapsed / 300, 1);
        setAngle((a) => (a + step) % TAU);
      }
      last = now;
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(id);
  }, [reduced, dragging, stopMotion, heroVisible]);
  const turn = (direction: number) => {
    setAngle((a) => (a + direction * TAU / Math.max(items.length, 6)) % TAU);
  };
  function pointerDown(e: PointerEvent<HTMLDivElement>) {
    if (!e.isPrimary || e.button !== 0 || drag.current) return;
    const button = (e.target as HTMLElement).closest<HTMLElement>("[data-work]");
    drag.current = { x: e.clientX, y: e.clientY, lastX: e.clientX, moved: false, workId: button?.dataset.work, pointerId: e.pointerId };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function pointerMove(e: PointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - current.x, e.clientY - current.y) > 7) current.moved = true;
    if (current.moved) {
      const delta = (e.clientX - current.lastX) / e.currentTarget.getBoundingClientRect().width * TAU;
      setAngle((a) => (a + delta) % TAU);
      current.lastX = e.clientX;
    }
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
    <section ref={hero} className="winter-hero" aria-label="Авторские украшения ручной работы"
      style={{ "--hero-background": `url("${import.meta.env.BASE_URL}images/hero-background.webp")` } as CSSProperties}>
      <div className="winter-dust" aria-hidden="true">{Array.from({ length: 22 }, (_, i) => <i key={i} style={{ left: `${(i * 43 + 7) % 100}%`, top: `${(i * 31 + 12) % 100}%`, animationDelay: `${i * -.7}s` }} />)}</div>
      <div className="winter-copy">
        <div className="winter-eyebrow"><Sparkles size={16} /> МАЛЕНЬКОЕ НОВОГОДНЕЕ ЧУДО <span /></div>
        <h1>
          <span className="winter-title-line">Волшебные украшения,</span>{" "}
          <span className="winter-title-line"><em>в которых живёт </em><span className="winter-title-warmth">тепло.</span></span>
        </h1>
        <p>Авторские ёлочные игрушки ручной работы.<br />Немного волшебства. Много души.<br />И особая история для вашего дома.</p>
      </div>
      <div className="winter-tree-area">
        <div className={`winter-stage${dragging ? " is-dragging" : ""}`} tabIndex={0} role="group" aria-label="Вращающаяся ёлка с работами. Перетаскивайте или используйте стрелки на клавиатуре."
          onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}
          onLostPointerCapture={() => {
            if (drag.current) {
              drag.current = null;
              setDragging(false);
            }
          }}
          onKeyDown={(e) => { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); turn(e.key === "ArrowLeft" ? -1 : 1); } }}>
          <div className="tree-halo" aria-hidden="true" />
          <svg className="ribbon-tree" viewBox="0 0 700 640" aria-hidden="true">
            <defs>
              <linearGradient id="ribbon-gold" x1="0" y1="0" x2="1" y2=".6"><stop stopColor="#71452f" /><stop offset=".25" stopColor="#e4af72" /><stop offset=".48" stopColor="#fff1cb" /><stop offset=".65" stopColor="#c88c53" /><stop offset="1" stopColor="#704334" /></linearGradient>
              <linearGradient id="ribbon-rose"><stop stopColor="#654053" /><stop offset=".5" stopColor="#e4b4c4" /><stop offset="1" stopColor="#89566a" /></linearGradient>
              <filter id="gold-glow"><feGaussianBlur stdDeviation="3" /></filter>
            </defs>
            <path d="M350 48 C330 190 295 320 260 558 L440 558 C405 320 370 190 350 48" fill="url(#ribbon-gold)" opacity=".06" />
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const y = 119 + i * 79, rx = 52 + i * 43, ry = 15 + i * 5;
              return <g key={i} transform={`translate(350 ${y}) rotate(${Math.sin(angle + i * .7) * 7 - 11})`}>
                <ellipse rx={rx} ry={ry} fill="none" stroke="url(#ribbon-rose)" strokeWidth="15" opacity=".26" />
                <ellipse rx={rx} ry={ry} fill="none" stroke="url(#ribbon-gold)" strokeWidth="10" opacity=".72" />
                <ellipse rx={rx} ry={ry} fill="none" stroke="#fff0c8" strokeWidth="1.5" transform="translate(0 -4)" opacity=".7" />
              </g>;
            })}
            <path d="M350 58 C330 125 440 160 420 218 S160 295 215 355 S625 425 544 486 S304 525 240 506" fill="none" stroke="url(#ribbon-gold)" strokeWidth="12" opacity=".38" />
            <path d="M350 58 C330 125 440 160 420 218 S160 295 215 355 S625 425 544 486 S304 525 240 506" fill="none" stroke="#fff0ca" strokeWidth="1" opacity=".45" />
            {Array.from({ length: 30 }, (_, i) => {
              const y = 115 + i * 15, phase = i * 2.4 + angle, width = 35 + i * 8;
              return <g key={i}><circle cx={350 + Math.sin(phase) * width} cy={y} r="5" fill="#ffc981" opacity=".5" filter="url(#gold-glow)" /><circle cx={350 + Math.sin(phase) * width} cy={y} r="1.7" fill="#fff0c5" /></g>;
            })}
          </svg>
          <div className="tree-lights" aria-hidden="true">{Array.from({ length: 25 }, (_, i) => {
            const level = treeLevels[(i * 3) % treeLevels.length];
            return <i key={i} style={{ left: `${50 + Math.sin(i * 2.39) * level.radius}%`, top: `${level.y + ((i % 3) - 1) * 2}%`, animationDelay: `${i * -.41}s` }} />;
          })}</div>
          <div className="tree-star" aria-hidden="true">✧</div>
          {Array.from({ length: count }, (_, i) => {
            const work = items[i], level = treeLevels[i % treeLevels.length];
            const phase = angle + ornamentPhases[i % ornamentPhases.length];
            const depth = Math.cos(phase), x = 50 + Math.sin(phase) * level.radius;
            const y = level.y + (ornamentNoise(i, 113) - .5) * 2 + depth * 2;
            const style = { left: `${x}%`, top: `${y}%`, transform: `translate(-50%, -25%) scale(${level.scale * (.83 + (depth + 1) * .12)})`, zIndex: Math.round(20 + depth * 10), opacity: .58 + (depth + 1) * .21 };
            return work ? <button key={work.id} data-work={work.id} className={`tree-toy${work.framed ? " tree-toy-framed" : ""}`} style={style} disabled={!ready} aria-label={`Рассмотреть: ${work.title}`} onClick={(e) => { if (e.detail === 0 && ready) onOpen(work.work); }}>
              <span className="toy-thread" aria-hidden="true" />
              <CatalogImage draggable={false} src={assetUrl(work.imageUrl)} alt={work.title} />
              <span className="toy-title">{work.title} <ArrowUpRight size={13} /></span>
            </button> : <div key={`bauble-${i}`} className={`tree-bauble bauble-${i % 3}`} style={style} aria-hidden="true"><span className="toy-thread" /><span>✧</span></div>;
          })}
        </div>
        {editorActions && <div className="tree-editor-actions" role="group" aria-label="Управление украшениями">{editorActions}</div>}
      </div>
    </section>
    <HeroValues />
  </>;
}
