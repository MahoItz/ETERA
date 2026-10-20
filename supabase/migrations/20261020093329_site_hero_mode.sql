-- One shared appearance setting; existing admin-only write policies still apply.
alter table public.site_settings
  add column hero_mode text not null default 'standard'
  constraint site_settings_hero_mode_check check (hero_mode in ('standard', 'new-year'));
