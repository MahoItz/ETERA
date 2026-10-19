import type { Settings } from "./model";

type Contacts = Pick<Settings, "contact" | "vk" | "telegram" | "phone">;
export type ContactLink = { label: string; href: string; phone?: boolean };

function webLink(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? value : null;
  } catch { return null; }
}

function phoneLink(value: string) {
  if (!/^\+?[\d\s().-]+$/.test(value)) return null;
  const compact = value.replace(/[\s().-]/g, "");
  return /^\+?\d{5,15}$/.test(compact) ? `tel:${compact}` : null;
}

export function normalizeContacts(input: Contacts): Contacts {
  const contacts = {
    contact: input.contact.trim(), vk: input.vk.trim(),
    telegram: input.telegram.trim(), phone: input.phone.trim(),
  };
  for (const [key, label] of [["contact", "Instagram"], ["vk", "ВКонтакте"], ["telegram", "Telegram"]] as const) {
    if (contacts[key] && (contacts[key].length > 300 || !webLink(contacts[key]))) {
      throw new Error(`${label}: укажите полную ссылку, начинающуюся с https:// или http://.`);
    }
  }
  if (contacts.phone && (contacts.phone.length > 40 || !phoneLink(contacts.phone))) {
    throw new Error("Проверьте номер телефона: от 5 до 15 цифр, можно использовать +, пробелы, скобки и дефисы.");
  }
  return contacts;
}

export function contactLinks(settings: Contacts): ContactLink[] {
  const links: ContactLink[] = [];
  for (const [value, label] of [[settings.contact, "Instagram"], [settings.vk, "ВКонтакте"], [settings.telegram, "Telegram"]]) {
    const href = value?.trim() && webLink(value.trim());
    if (href) links.push({ label, href });
  }
  const phone = settings.phone?.trim();
  const href = phone && phoneLink(phone);
  if (href) links.push({ label: phone, href, phone: true });
  return links;
}
