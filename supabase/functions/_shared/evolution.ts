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
  // Timeout duro: Evolution puede colgarse en el envío y dejar la función edge
  // muriendo por wall-time (job mudo). Aborta a 25s y lanza; el catch del llamador
  // lo trata como error limpio en vez de colgarse. No dispara el kill-switch
  // (el regex de baneo busca "Evolution <3 dígitos>", no coincide con este mensaje).
  const EVO_TIMEOUT_MS = 25000;
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), EVO_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${EVOLUTION_URL}${path}`, { ...init, headers, signal: ac.signal });
  } catch (e) {
    throw new Error(`Evolution fetch abort/error: ${String((e as any)?.message ?? e).slice(0, 120)}`);
  } finally {
    clearTimeout(to);
  }
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