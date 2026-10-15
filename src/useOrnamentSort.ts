import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { TreeOrnament } from "./tree-items";

type Drag = {
  id: string;
  previous: TreeOrnament[];
  ordered: TreeOrnament[];
  pointerId: number | null;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
};

export function useOrnamentSort(
  ornaments: TreeOrnament[],
  disabled: boolean,
  onCommit: (previous: TreeOrnament[], ordered: TreeOrnament[]) => Promise<void>,
) {
  const listRef = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const savingRef = useRef(false);
  const [preview, setPreview] = useState<TreeOrnament[] | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const sorted = [...ornaments].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));

  function moveTo(index: number) {
    const active = drag.current;
    if (!active) return;
    const from = active.ordered.findIndex((item) => item.id === active.id);
    const target = Math.max(0, Math.min(index, active.ordered.length - 1));
    if (from === target) return;
    const next = [...active.ordered];
    const [item] = next.splice(from, 1);
    next.splice(target, 0, item);
    active.ordered = next;
    active.moved = true;
    setPreview(next);
    setAnnouncement(`«${item.title}»: позиция ${target + 1} из ${next.length}.`);
  }

  function moveAtPointer() {
    const active = drag.current, list = listRef.current;
    if (!active || !list) return;
    const bounds = list.getBoundingClientRect();
    if (active.x < bounds.left || active.x > bounds.right || active.y < bounds.top - 32 || active.y > bounds.bottom + 32) return;
    const cards = Array.from(list.querySelectorAll<HTMLElement>("[data-ornament-id]"));
    let closest = -1, distance = Infinity;
    cards.forEach((card, index) => {
      const rect = card.getBoundingClientRect();
      if (rect.bottom < bounds.top || rect.top > bounds.bottom) return;
      const candidate = (active.x - rect.left - rect.width / 2) ** 2 + (active.y - rect.top - rect.height / 2) ** 2;
      if (candidate < distance) { distance = candidate; closest = index; }
    });
    if (closest >= 0) moveTo(closest);
  }

  useEffect(() => {
    if (!draggingId || drag.current?.pointerId === null) return;
    let frame = 0;
    const scroll = () => {
      const active = drag.current, list = listRef.current;
      if (!active || !list) return;
      const bounds = list.getBoundingClientRect();
      if (active.x >= bounds.left && active.x <= bounds.right) {
        const before = list.scrollTop;
        if (active.y < bounds.top + 36) list.scrollTop -= 10;
        else if (active.y > bounds.bottom - 36) list.scrollTop += 10;
        if (list.scrollTop !== before) moveAtPointer();
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [draggingId]);

  function cancel() {
    if (!drag.current) return false;
    drag.current = null;
    setPreview(null);
    setDraggingId(null);
    setAnnouncement("Перемещение отменено. Прежний порядок сохранён.");
    return true;
  }

  async function commit() {
    const active = drag.current;
    if (!active || savingRef.current) return;
    drag.current = null;
    setDraggingId(null);
    if (active.previous.every((item, index) => item.id === active.ordered[index].id)) {
      setPreview(null);
      setAnnouncement("Порядок не изменён.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setAnnouncement("Сохраняем порядок…");
    try {
      await onCommit(active.previous, active.ordered);
      setAnnouncement("Порядок украшений сохранён.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сохранить порядок. Обновите страницу и попробуйте снова.");
      setAnnouncement("");
    } finally {
      savingRef.current = false;
      setSaving(false);
      setPreview(null);
      requestAnimationFrame(() => {
        const card = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-ornament-id]") ?? [])
          .find((item) => item.dataset.ornamentId === active.id);
        card?.querySelector<HTMLButtonElement>(".tree-drag-handle")?.focus({ preventScroll: true });
      });
    }
  }

  function start(id: string, pointerId: number | null, x = 0, y = 0) {
    if (disabled || savingRef.current || drag.current || sorted.length < 2) return false;
    drag.current = { id, previous: sorted, ordered: sorted, pointerId, startX: x, startY: y, x, y, moved: pointerId === null };
    setError("");
    if (pointerId === null) {
      setPreview(sorted);
      setDraggingId(id);
      setAnnouncement("Украшение выбрано для перемещения. Используйте стрелки, затем нажмите Пробел. Escape — отмена.");
    }
    return true;
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (!event.isPrimary || event.button !== 0 || !start(id, event.pointerId, event.clientX, event.clientY)) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    listRef.current?.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    active.x = event.clientX;
    active.y = event.clientY;
    if (!active.moved && Math.hypot(active.x - active.startX, active.y - active.startY) < 6) return;
    active.moved = true;
    setDraggingId(active.id);
    moveAtPointer();
  }
  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const bounds = listRef.current?.getBoundingClientRect();
    if (bounds && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top - 32 || event.clientY > bounds.bottom + 32)) cancel();
    else void commit();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    const active = drag.current;
    if (event.key === "Escape" && active) { event.preventDefault(); event.stopPropagation(); cancel(); return; }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      if (event.repeat) return;
      if (active?.pointerId === null && active.id === id) void commit();
      else start(id, null);
      return;
    }
    if (!active || active.pointerId !== null || active.id !== id) return;
    const columns = listRef.current ? getComputedStyle(listRef.current).gridTemplateColumns.split(" ").length : 1;
    const index = active.ordered.findIndex((item) => item.id === id);
    const next = { ArrowLeft: index - 1, ArrowRight: index + 1, ArrowUp: index - columns, ArrowDown: index + columns, Home: 0, End: active.ordered.length - 1 }[event.key];
    if (next !== undefined) {
      event.preventDefault();
      moveTo(next);
      const handle = event.currentTarget;
      requestAnimationFrame(() => handle.scrollIntoView({ block: "nearest" }));
    }
  }

  return { listRef, sorted: preview ?? sorted, draggingId, saving, error, announcement, active: drag.current !== null,
    cancel, pointerDown, pointerMove, pointerUp, keyDown };
}
