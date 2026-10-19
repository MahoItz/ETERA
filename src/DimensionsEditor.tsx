import { useEffect, useId, useRef, useState } from "react";
import { ArrowDownUp, ArrowLeftRight, MoveUpRight, X } from "lucide-react";
import { changeSizeUnit, displaySize, sizeAxes, unitLabel, type SizeDraft } from "../lib/measurements";
import "./dimensions.css";

export function DimensionsEditor({ value, onChange, suggestions, onDelete, disabled, label = "Размеры фигурки", inherited }: {
  value: SizeDraft; onChange: (value: SizeDraft) => void; suggestions: number[];
  onDelete: (mm: number) => Promise<void>; disabled: boolean; label?: string; inherited?: SizeDraft;
}) {
  const [unitError, setUnitError] = useState("");
  return <fieldset className="dimensions-editor" disabled={disabled}>
    <legend>{label}</legend>
    <div className="size-unit-row">
      <span>{inherited ? "Пустое поле — размер работы" : "Укажите известные размеры"}</span>
      <div className="size-unit-switch" role="group" aria-label={`Единицы: ${label}`}>
        {(["cm", "mm"] as const).map((unit) => <button type="button" key={unit} aria-pressed={value.unit === unit}
          onClick={() => {
            try { onChange(changeSizeUnit(value, unit)); setUnitError(""); }
            catch (error) { setUnitError(error instanceof Error ? error.message : "Проверьте размеры."); }
          }}>{unitLabel(unit)}</button>)}
      </div>
    </div>
    <div className="size-input-grid">
      {sizeAxes.map(({ key, label: axisLabel }, index) => <SizeInput key={key}
        label={axisLabel} scope={label} value={value[key]} unit={value.unit} suggestions={suggestions}
        placeholder={inherited?.[key]} onChange={(number) => { onChange({ ...value, [key]: number }); setUnitError(""); }}
        onDelete={onDelete} icon={index} />)}
    </div>
    {unitError && <p className="form-error" role="alert">{unitError}</p>}
  </fieldset>;
}

function SizeInput({ label, scope, value, unit, suggestions, onChange, onDelete, placeholder, icon }: {
  label: string; scope: string; value: string; unit: SizeDraft["unit"]; suggestions: number[];
  onChange: (value: string) => void; onDelete: (mm: number) => Promise<void>; placeholder?: string; icon: number;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const Icon = [ArrowDownUp, ArrowLeftRight, MoveUpRight][icon];
  const choices = [...new Set(suggestions)].sort((a, b) => a - b)
    .filter((mm) => !value || displaySize(mm, unit).replace(",", ".").startsWith(value.replace(",", ".")));
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return <div className="size-input" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={(event) => {
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); input.current?.focus(); setOpen(false); }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); setOpen(true);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      requestAnimationFrame(() => {
        const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("[data-size-choice]") ?? []);
        const current = buttons.findIndex((button) => button === document.activeElement);
        const next = current < 0 ? (direction > 0 ? 0 : buttons.length - 1) : (current + direction + buttons.length) % buttons.length;
        buttons[next]?.focus();
      });
    }
  }}>
    <label htmlFor={id}><Icon size={14} aria-hidden="true" />{label}</label>
    <div className="size-input-wrap">
      <input ref={input} id={id} type="text" inputMode="decimal" autoComplete="off" maxLength={14}
        aria-label={`${label}: ${scope}`} role="combobox" aria-haspopup="dialog"
        aria-expanded={open && choices.length > 0} aria-controls={open && choices.length ? `${id}-choices` : undefined}
        value={value} placeholder={placeholder || "—"} onChange={(event) => { onChange(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)} />
      <span>{unitLabel(unit)}</span>
    </div>
    {open && choices.length > 0 && <div className="size-suggestions" id={`${id}-choices`} role="dialog" aria-label={`Прошлые размеры: ${label}`}>
      {choices.map((mm) => <div className="size-suggestion" key={mm}>
        <button type="button" data-size-choice onClick={() => {
          onChange(displaySize(mm, unit)); input.current?.focus(); setOpen(false);
        }}>{displaySize(mm, unit)} <span>{unitLabel(unit)}</span></button>
        <button type="button" className="size-suggestion-remove" disabled={deleting}
          aria-label={`Удалить ${displaySize(mm, unit)} ${unitLabel(unit)} из подсказок`}
          onClick={async () => { setDeleting(true); try { await onDelete(mm); } finally { setDeleting(false); input.current?.focus(); } }}>
          <X size={14} />
        </button>
      </div>)}
    </div>}
  </div>;
}
