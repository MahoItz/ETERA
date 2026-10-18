import { createClient } from "@supabase/supabase-js";
import { createCleanupHandler } from "./worker.ts";

// The service key stays in the Edge Function's built-in server environment.
const client = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
Deno.serve(createCleanupHandler(client));
