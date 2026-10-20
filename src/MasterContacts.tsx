import { useId, type ReactNode } from "react";
import { ArrowUpRight, Camera, MessageCircle, Phone, Send } from "lucide-react";
import { contactLinks } from "../lib/contacts";
import type { Settings } from "../lib/model";

export function MasterContacts({ settings, showEmpty = false, compact = false, children }: { settings: Settings; showEmpty?: boolean; compact?: boolean; children?: ReactNode }) {
  const headingId = useId();
  const links = contactLinks(settings);
  if (!links.length && !showEmpty && !children) return null;
  return <section className={"master-contacts" + (children ? " has-chat" : "") + (compact ? " is-editorial" : "")} aria-labelledby={compact ? undefined : headingId} aria-label={compact ? "Связаться с мастером" : undefined}>
    {!compact && <h3 id={headingId}>Связаться с мастером</h3>}
    {children}
    {links.length ? <>
      <p className={children ? "chat-alternatives" : undefined}>{children ? "Другие способы связи" : "Выберите удобный способ связи."}</p>
      <div className={"master-contact-list" + (children ? " is-compact" : "")}>
        {links.map((link) => {
          if (children) return <a key={link.label} href={link.href} target={link.phone ? undefined : "_blank"} rel={link.phone ? undefined : "noreferrer"}>{link.phone && <Phone size={14} aria-hidden="true" />}{link.label}</a>;
          const Icon = link.phone ? Phone : link.label === "Instagram" ? Camera : link.label === "Telegram" ? Send : MessageCircle;
          const destination = link.phone ? link.label : new URL(link.href).host.replace(/^www\./, "") + new URL(link.href).pathname.replace(/\/$/, "");
          return <a key={link.label} href={link.href} target={link.phone ? undefined : "_blank"} rel={link.phone ? undefined : "noreferrer"}>
            <span className="master-contact-icon"><Icon size={19} aria-hidden="true" /></span>
            <span className="master-contact-text"><strong>{link.phone ? "Телефон" : link.label}</strong><span>{destination}</span></span>
            {!link.phone && <ArrowUpRight size={16} className="master-contact-arrow" aria-hidden="true" />}
          </a>;
        })}
      </div>
    </> : !children && <p>Контакты мастера появятся здесь после настройки.</p>}
  </section>;
}
