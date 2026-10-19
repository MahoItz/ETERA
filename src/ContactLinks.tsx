import { Phone } from "lucide-react";
import { contactLinks } from "../lib/contacts";
import type { Settings } from "../lib/model";

export function ContactLinks({ settings }: { settings: Settings }) {
  const links = contactLinks(settings);
  if (!links.length) return null;
  return <div className="contact-links" role="group" aria-label="Контакты мастерской">
    {links.map((link) => <a key={link.label} href={link.href} target={link.phone ? undefined : "_blank"} rel={link.phone ? undefined : "noreferrer"}>
      {link.phone && <Phone size={14} aria-hidden="true" />}{link.label}
    </a>)}
  </div>;
}
