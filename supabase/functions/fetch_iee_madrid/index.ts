// fetch_iee_madrid — consulta el estado IEE/ITE de un edificio de Madrid.
// Estrategia:
//   1. Si payload trae `manual` con estado+fecha → se aplica tal cual.
//   2. Si no, intenta scrape vía Firecrawl + extracción LLM de la sede del Ayto Madrid.
//   3. Si no hay resultado y el edificio tiene >=30 años → `pendiente`. Si no, `no_procede`.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FIRECRAWL_V2 = "https://api.firecrawl.dev/v2";
const LOVABLE_AI = "https://ai.gateway.lovable.dev/v1";

type IeeEstado =
  | "favorable" | "desfavorable_leve" | "desfavorable_grave"
  | "pendiente" | "caducada" | "no_procede" | "desconocido";

async function firecrawlSearch(query: string) {
  const key = Deno.env.get("FIRECRAWL_API_KEY");
  if (!key) throw new Error("FIRECRAWL_API_KEY missing");
  const res = await fetch(`${FIRECRAWL_V2}/search`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      limit: 4,
      lang: "es",
      country: "es",
      scrapeOptions: { formats: ["markdown"] },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `firecrawl ${res.status}`);
  return Array.isArray(data?.data) ? data.data : [];
}

async function extractIeeFromText(snippets: string): Promise<{
  estado: IeeEstado; fecha_inspeccion: string | null; deficiencias: any[]; confianza: number;
}> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  const res = await fetch(`${LOVABLE_AI}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-3-flash-preview",
      messages: [
        { role: "system", content: `Eres un extractor. Devuelves SOLO JSON: {"estado":"favorable|desfavorable_leve|desfavorable_grave|pendiente|caducada|no_procede|desconocido","fecha_inspeccion":"YYYY-MM-DD|null","deficiencias":[{"categoria":"...","gravedad":"leve|grave|muy_grave","descripcion":"..."}],"confianza":0..1}. "favorable"=sin deficiencias; "desfavorable_leve"=deficiencias leves; "desfavorable_grave"=graves/muy graves; "caducada"=presentado pero ya pasó la vigencia; "pendiente"=obligado y nunca presentado; "no_procede"=edificio <30 años o exento. Si no estás seguro, "desconocido" con confianza<0.4.` },
        { role: "user", content: snippets.slice(0, 12000) },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `ai ${res.status}`);
  const raw = data?.choices?.[0]?.message?.content ?? "{}";
  const json = JSON.parse(raw.replace(/^```json|```$/g, "").trim());
  return {
    estado: (json.estado || "desconocido") as IeeEstado,
    fecha_inspeccion: json.fecha_inspeccion || null,
    deficiencias: Array.isArray(json.deficiencias) ? json.deficiencias : [],
    confianza: Number(json.confianza ?? 0),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = await req.json().catch(() => ({}));
    const { building_id, manual } = body ?? {};
    if (!building_id) throw new Error("building_id requerido");

    const { data: b, error } = await admin
      .from("buildings")
      .select("id, direccion, refcatastral, metadatos")
      .eq("id", building_id).single();
    if (error || !b) throw new Error("edificio no encontrado");

    // Anio construccion para decidir si IEE es obligatoria
    const md: any = b.metadatos ?? {};
    const anioRaw = md?.ano_construccion ?? md?.anio_construccion ?? md?.year_built ?? null;
    const anio = anioRaw ? Number(String(anioRaw).match(/\d{4}/)?.[0]) : null;
    const antiguedad = anio ? new Date().getFullYear() - anio : null;

    let estado: IeeEstado = "desconocido";
    let fecha_inspeccion: string | null = null;
    let deficiencias: any[] = [];
    let fuente = "desconocido";

    if (manual && manual.estado) {
      estado = manual.estado;
      fecha_inspeccion = manual.fecha_inspeccion ?? null;
      deficiencias = manual.deficiencias ?? [];
      fuente = "manual";
    } else {
      try {
        const refcat = b.refcatastral || "";
        const q = `Registro IEE Madrid "${b.direccion}"${refcat ? ` ${refcat.slice(0,14)}` : ""}`;
        const results = await firecrawlSearch(q);
        const snippets = results
          .map((r: any) => `URL: ${r.url}\nTITLE: ${r.title}\n${r.markdown || r.description || ""}`)
          .join("\n\n---\n\n");
        if (snippets.trim().length > 50) {
          const ext = await extractIeeFromText(`Dirección: ${b.direccion}\nRefCatastral: ${refcat}\n\n${snippets}`);
          if (ext.confianza >= 0.4 && ext.estado !== "desconocido") {
            estado = ext.estado;
            fecha_inspeccion = ext.fecha_inspeccion;
            deficiencias = ext.deficiencias;
            fuente = "sede_madrid_llm";
          }
        }
      } catch (e) {
        console.warn("[fetch_iee_madrid] firecrawl/llm failed", (e as any)?.message);
      }

      // Fallback por antigüedad
      if (estado === "desconocido" && antiguedad != null) {
        if (antiguedad >= 30) { estado = "pendiente"; fuente = "fallback_antiguedad"; }
        else { estado = "no_procede"; fuente = "fallback_antiguedad"; }
      }
    }

    await admin.from("buildings").update({
      iee_estado: estado,
      iee_fecha_inspeccion: fecha_inspeccion,
      iee_deficiencias: deficiencias,
      iee_fuente: fuente,
      iee_actualizado_at: new Date().toISOString(),
    }).eq("id", building_id);

    // Recomputar el score con la nueva info (mejor esfuerzo: el builder de
    // supabase-js no tiene .catch — usar try/catch, si no toda la función da 500)
    try { await admin.rpc("compute_cluster_score", { p_building_id: building_id }); } catch (_e) { /* noop */ }

    return new Response(JSON.stringify({
      ok: true, building_id, estado, fecha_inspeccion, deficiencias, fuente, antiguedad,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});