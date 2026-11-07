import { supabase } from "./supabase";
import type { CartItem } from "../lib/cart";

function check(error: { code?: string; message: string } | null) {
  if (!error) return;
  if (["PGRST202", "PGRST205", "42P01"].includes(error.code ?? "")) throw new Error("Корзина пока недоступна. Попробуйте позже.");
  if (error.code === "42501") throw new Error("Войдите в аккаунт, чтобы пользоваться корзиной.");
  if (error.code === "22023") throw new Error("Проверьте подборку и комментарий (до 2000 символов).");
  if (error.code === "P0001") throw new Error("Корзина вмещает до 50 фигурок. Удалите лишние позиции.");
  if (error.code === "P0002") throw new Error("Одна из фигурок больше недоступна. Обновите корзину и удалите недоступные позиции.");
  if (error.code === "40001") throw new Error("Корзина изменилась. Обновите её перед отправкой.");
  throw new Error("Не удалось связаться с сервером. Попробуйте ещё раз.");
}

export async function loadCart(userId: string, signal: AbortSignal): Promise<CartItem[]> {
  const { data, error } = await supabase.rpc("cart_list").abortSignal(signal);
  check(error);
  return ((data ?? []) as CartItem[]).filter(item => item.user_id === userId);
}

export async function addCartItem(workId: string, variantId: string | null): Promise<CartItem> {
  const { data, error } = await supabase.rpc("cart_add", { target_work_id: workId, target_variant_id: variantId });
  check(error);
  if (!data) throw new Error("Не получено подтверждение добавления. Повторите попытку.");
  return data as CartItem;
}

export async function removeCartItem(id: string, userId: string) {
  const { error } = await supabase.from("cart_items").delete().eq("id", id).eq("user_id", userId);
  check(error);
}

export async function submitCart(requestId: string, itemIds: string[], comment: string): Promise<string> {
  const { data, error } = await supabase.rpc("cart_submit", { request_id: requestId, item_ids: itemIds, message_body: comment });
  check(error);
  if (!data?.conversation_id) throw new Error("Не получено подтверждение отправки. Повторите попытку.");
  return data.conversation_id;
}
