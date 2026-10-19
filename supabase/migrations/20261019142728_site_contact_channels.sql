-- The existing contact column remains the Instagram URL for compatibility.
alter table public.site_settings
  add column vk text not null default '' check (char_length(vk) <= 300),
  add column telegram text not null default '' check (char_length(telegram) <= 300),
  add column phone text not null default '' check (char_length(phone) <= 40);
