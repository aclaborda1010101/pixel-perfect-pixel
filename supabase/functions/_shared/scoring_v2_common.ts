// Helpers compartidos para las edge functions de Scoring v2
import { createClient } from "jsr:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function err(message: string, status = 500, extra?: Record<string, unknown>) {
  return json({ error: message, ...(extra ?? {}) }, status);
}

export async function getSetting<T = unknown>(key: string): Promise<T | null> {
  const sb = getServiceClient();
  const { data } = await sb.from("app_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? null;
}

export async function setProcessingStatus(
  building_id: string,
  current_phase: string,
  status: "running" | "ok" | "error",
  error?: string,
) {
  const sb = getServiceClient();
  await sb.from("building_processing_status").upsert({
    building_id,
    current_phase,
    status,
    started_at: status === "running" ? new Date().toISOString() : undefined,
    finished_at: status !== "running" ? new Date().toISOString() : null,
    error: error ?? null,
    updated_at: new Date().toISOString(),
  });
}

export async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}