import { useId } from "react";
import { displaySize, sizeAxes, unitLabel, type Measurements } from "../lib/measurements";
import "./dimensions.css";

export function SizeDiagram({ value }: { value: Measurements }) {
  const marker = useId().replace(/:/g, "");
  return <section className="size-display" aria-label="Размеры фигурки">
    <div className="size-display-heading">Размеры</div>
    <div className="size-display-body">
      <svg className="size-diagram" viewBox="0 0 220 180" fill="none" aria-hidden="true">
        <defs><marker id={marker} viewBox="0 0 8 8" refX="4" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M1 1L7 4L1 7" fill="none" stroke="currentColor" strokeWidth="1.4" /></marker></defs>
        <path d="M67 51L116 23L172 55L123 84Z" fill="#ead7e9" />
        <path d="M67 51L123 84V145L67 112Z" fill="#f7e7de" />
        <path d="M123 84L172 55V116L123 145Z" fill="#ddc3de" />
        <path d="M67 51L116 23L172 55V116L123 145L67 112ZM67 51L123 84L172 55M123 84V145" stroke="#a7839c" strokeWidth="1.5" strokeLinejoin="round" />
        <g stroke="currentColor" strokeWidth="1.3" markerStart={`url(#${marker})`} markerEnd={`url(#${marker})`}>
          {value.heightMm !== null && <path className="size-height" d="M45 52V112" />}
          {value.widthMm !== null && <path className="size-width" d="M67 136L122 168" />}
          {value.depthMm !== null && <path className="size-depth" d="M145 149L193 121" />}
        </g>
      </svg>
      <dl className="size-values">
        {sizeAxes.filter(({ field }) => value[field] !== null).map(({ key, field, label }) => <div key={key}>
          <dt><span className={`size-axis size-${key}`} aria-hidden="true" />{label}</dt>
          <dd>{displaySize(value[field]!, value.unit)} <span>{unitLabel(value.unit)}</span></dd>
        </div>)}
      </dl>
    </div>
  </section>;
}
