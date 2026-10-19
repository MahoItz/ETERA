import { supabase } from "./supabase";

export type ChatMessage = { id: string; seq: number; conversation_id: string; sender_id: string | null; sender_role: "customer" | "admin"; body: string; created_at: string };
export type ChatThread = { id: string; customer_id: string; work_id: string | null; work_title: string; updated_at: string; participant_label: string; unread_count: number; last_message: string | null };
export type ChatInboxData = { threads: ChatThread[]; unread_count: number; has_more: boolean };
export const CHAT_REFRESH = "etera-chat-refresh";
export const refreshChat = () => window.dispatchEvent(new Event(CHAT_REFRESH));
export const notifyChatRead = (conversationId: string, userId: string) =>
  window.dispatchEvent(new CustomEvent(CHAT_REFRESH, { detail: { conversationId, userId } }));

function check(error: { code?: string; message: string } | null) {
  if (!error) return;
  if (["PGRST202", "PGRST205", "42P01"].includes(error.code ?? "")) throw new Error("Чат пока недоступен. Нужно обновить базу данных сайта.");
  if (error.code === "42501") throw new Error("Переписка недоступна. Проверьте, что вы вошли в свой аккаунт.");
  if (error.code === "22023") throw new Error("Проверьте сообщение: от 1 до 4000 символов.");
  throw new Error("Не удалось связаться с сервером. Попробуйте ещё раз.");
}

export async function loadChatInbox(signal: AbortSignal, cursor?: ChatThread): Promise<ChatInboxData> {
  const { data, error } = await supabase.rpc("chat_inbox", { before_updated_at: cursor?.updated_at ?? null, before_id: cursor?.id ?? null }).abortSignal(signal);
  check(error);
  if (!data) throw new Error("Не удалось получить переписку.");
  return data as ChatInboxData;
}

export async function findWorkConversation(workId: string, userId: string, signal: AbortSignal) {
  const { data, error } = await supabase.from("chat_conversations").select("id").eq("work_id", workId).eq("customer_id", userId).abortSignal(signal).maybeSingle();
  check(error);
  return data?.id as string | undefined;
}

export async function loadChatThread(id: string, signal: AbortSignal): Promise<ChatThread> {
  const { data, error } = await supabase.from("chat_conversations").select("*").eq("id", id).abortSignal(signal).single();
  check(error);
  if (!data) throw new Error("Переписка больше недоступна.");
  return { ...data, participant_label: "Переписка с мастером", unread_count: 0, last_message: null } as ChatThread;
}

export async function loadChatMessages(id: string, signal: AbortSignal, options: { before?: number; after?: number } = {}): Promise<ChatMessage[]> {
  let query = supabase.from("chat_messages").select("id, seq, conversation_id, sender_id, sender_role, body, created_at").eq("conversation_id", id);
  if (options.before !== undefined) query = query.lt("seq", options.before);
  if (options.after !== undefined) query = query.gt("seq", options.after);
  const { data, error } = await query.order("seq", { ascending: options.after !== undefined }).limit(50).abortSignal(signal);
  check(error);
  return (data ?? []) as ChatMessage[];
}

export async function sendChatMessage(requestId: string, body: string, conversationId?: string, workId?: string): Promise<{ conversation_id: string; message: ChatMessage }> {
  const { data, error } = await supabase.rpc("chat_send", { request_id: requestId, message_body: body, target_conversation_id: conversationId ?? null, target_work_id: workId ?? null });
  check(error);
  if (!data) throw new Error("Не получено подтверждение отправки. Повторите попытку.");
  return data;
}

export async function markChatRead(id: string, seq: number) {
  const { error } = await supabase.rpc("chat_mark_read", { target_conversation_id: id, through_seq: seq });
  check(error);
}

export function mergeMessages(current: ChatMessage[], added: ChatMessage[]) {
  return [...new Map([...current, ...added].map(message => [message.id, message])).values()].sort((a, b) => a.seq - b.seq);
}
