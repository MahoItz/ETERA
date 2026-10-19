import { supabase } from "./supabase";

export type DashboardPeriod = 7 | 30 | 90;
export type AdminDashboardData = {
  period_days: DashboardPeriod;
  generated_at: string;
  total_users: number;
  new_users: number;
  total_favorites: number;
  period_favorites: number;
  favorited_works: number;
  users_with_favorites: number;
  total_works: number;
  published_works: number;
  draft_works: number;
  archived_works: number;
  popular_works: Array<{
    id: string;
    slug: string;
    title: string;
    status: "published" | "draft" | "archived";
    availability: "available" | "order" | "sold";
    photo_url: string | null;
    favorites: number;
  }>;
};

export async function loadAdminDashboard(period: DashboardPeriod, signal: AbortSignal): Promise<AdminDashboardData> {
  const { data, error } = await supabase.rpc("admin_dashboard", { period_days: period }).abortSignal(signal);
  if (error) {
    if (error.code === "42501") throw new Error("Статистика доступна только администратору. Войдите в аккаунт администратора.");
    if (error.code === "PGRST202") throw new Error("Для статистики нужно применить обновление базы данных. Настройки сайта доступны в соседнем разделе.");
    throw new Error("Не удалось загрузить статистику. Попробуйте ещё раз.");
  }
  if (!data) throw new Error("Не удалось получить статистику. Попробуйте ещё раз.");
  return data as AdminDashboardData;
}
