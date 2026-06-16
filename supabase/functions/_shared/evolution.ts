// Evolution API helper shared across WhatsApp edge functions
const URL_RAW = Deno.env.get("EVOLUTION_API_URL") ?? "";
export const EVOLUTION_URL = URL_RAW.replace(/\/+$/, "");
export const EVOLUTION_KEY = Deno.env.get("EVOLUTION_API_KEY") ?? "";
export const EVOLUTION_INSTANCE = Deno.env.get("EVOLUTION_INSTANCE_NAME") ?? "afflux";

export async function evoFetch(path: string, init: RequestInit = {}) {
  if (!EVOLUTION_URL || !EVOLUTION_KEY) {
    throw new Error("Evolution API no configurada (EVOLUTION_API_URL / EVOLUTION_API_KEY)");
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: EVOLUTION_KEY,
    ...(init.headers as Record<string, string> | undefined ?? {}),
  };
  const res = await fetch(`${EVOLUTION_URL}${path}`, { ...init, headers });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  if (!res.ok) {
    throw new Error(`Evolution ${res.status}: ${typeof json === "string" ? json : JSON.stringify(json)}`);
  }
  return json as any;
}

export function normalizePhone(input: string): string {
  return String(input || "").replace(/[^0-9]/g, "");
}