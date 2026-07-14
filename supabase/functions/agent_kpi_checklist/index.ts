import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// PRIMARIO: OpenRouter · openai/gpt-5.6-luna (si hay OPENROUTER_API_KEY).
// FALLBACK: Lovable AI Gateway · google/gemini-3-flash-preview.
const LUNA_MODEL = "openai/gpt-5.6-luna";
const FALLBACK_MODEL = "google/gemini-3-flash-preview";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

const KPIS: Array<{ clave: string; label: string; prioridad?: boolean }> = [
  { clave: "cuadro_rentas", label: "Cuadro de rentas y vencimientos", prioridad: true },
  { clave: "predisposicion", label: "Predisposición a vender" },
  { clave: "tipologia", label: "Tipología del propietario (T1–T10)" },
  { clave: "decide_solo", label: "¿Decide solo o en familia?" },
  { clave: "quien_bloquea", label: "Quién o qué bloquea" },
  { clave: "relacion_copropietarios", label: "Relación entre copropietarios" },
  { clave: "vive_en_edificio", label: "¿Vive en el edificio?" },
  { clave: "necesidad_liquidez", label: "Necesidad de liquidez" },
  { clave: "motivacion_urgencia", label: "Motivación / urgencia" },
  { clave: "oferta_previa", label: "¿Ha recibido oferta previa?" },
  { clave: "biografia", label: "Biografía / contexto del propietario" },
  { clave: "banderas_rojas", label: "Banderas rojas del activo (okupa, renta antigua, ITE, +80…)" },
  { clave: "interes_reunion", label: "Interés en reunión" },
  { clave: "whatsapp_abierto", label: "Canal WhatsApp abierto" },
  { clave: "n_copropietarios", label: "Nº de copropietarios y % de cada parte" },
];

function stripHtml(s: string): string {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { owner_id } = await req.json();
    if (!owner_id) {
      return new Response(JSON.stringify({ error: "owner_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1) Propietario
    const { data: owner } = await admin.from("owners").select("id,nombre,rol,telefono,notas_breves").eq("id", owner_id).maybeSingle();

    // 2) Llamadas enriquecidas (vista)
    const { data: callsView } = await (admin.from("v_owner_calls_enriched" as any) as any)
      .select("hs_timestamp,direccion,resultado,nota")
      .eq("owner_id", owner_id)
      .order("hs_timestamp", { ascending: false })
      .limit(50);

    // 3) HubSpot contact ids (para notas + WhatsApp)
    let hsIds: string[] = [];
    try {
      const { data: eids } = await admin.from("external_ids")
        .select("provider_id")
        .eq("entity_type", "owner")
        .eq("entity_id", owner_id)
        .eq("provider", "hubspot");
      hsIds = (eids ?? []).map((e: any) => String(e.provider_id)).filter(Boolean);
    } catch { /* opcional */ }

    // HubSpot deal ids: por los edificios en los que el owner participa
    let hsDealIds: string[] = [];
    try {
      const { data: bldgs } = await admin.from("building_owners").select("building_id").eq("owner_id", owner_id);
      const buildingIds = (bldgs ?? []).map((b: any) => b.building_id).filter(Boolean);
      if (buildingIds.length) {
        const { data: exd } = await admin.from("external_ids")
          .select("provider_id")
          .eq("entity_type", "building").eq("provider", "hubspot").eq("provider_object_type", "deal")
          .in("entity_id", buildingIds);
        hsDealIds = (exd ?? []).map((r: any) => String(r.provider_id)).filter(Boolean);
      }
    } catch { /* opcional */ }

    let hsNotes: any[] = [];
    let hsWa: any[] = [];
    if (hsIds.length || hsDealIds.length) {
      const seenN = new Set<string>();
      const seenW = new Set<string>();
      const runs: Promise<any>[] = [];
      // Notas por contacto
      if (hsIds.length) runs.push(admin.from("hubspot_notes").select("hs_id, hs_timestamp, hs_note_body").overlaps("associated_contact_ids", hsIds).order("hs_timestamp", { ascending: false }).limit(30));
      // Notas por deal
      if (hsDealIds.length) runs.push(admin.from("hubspot_notes").select("hs_id, hs_timestamp, hs_note_body").overlaps("associated_deal_ids", hsDealIds).order("hs_timestamp", { ascending: false }).limit(30));
      // WhatsApp por contacto
      if (hsIds.length) runs.push(admin.from("hubspot_whatsapp").select("hs_id, hs_timestamp, hs_communication_body").overlaps("associated_contact_ids", hsIds).order("hs_timestamp", { ascending: false }).limit(30));
      // WhatsApp por deal
      if (hsDealIds.length) runs.push(admin.from("hubspot_whatsapp").select("hs_id, hs_timestamp, hs_communication_body").overlaps("associated_deal_ids", hsDealIds).order("hs_timestamp", { ascending: false }).limit(30));
      try {
        const results = await Promise.all(runs);
        // orden de runs: notes/contact, notes/deal, wa/contact, wa/deal (según se hayan añadido)
        let idx = 0;
        if (hsIds.length) { for (const r of (results[idx].data || [])) { const id = String(r.hs_id ?? ""); if (id && !seenN.has(id)) { seenN.add(id); hsNotes.push(r); } } idx++; }
        if (hsDealIds.length) { for (const r of (results[idx].data || [])) { const id = String(r.hs_id ?? ""); if (id && !seenN.has(id)) { seenN.add(id); hsNotes.push(r); } } idx++; }
        if (hsIds.length) { for (const r of (results[idx].data || [])) { const id = String(r.hs_id ?? ""); if (id && !seenW.has(id)) { seenW.add(id); hsWa.push(r); } } idx++; }
        if (hsDealIds.length) { for (const r of (results[idx].data || [])) { const id = String(r.hs_id ?? ""); if (id && !seenW.has(id)) { seenW.add(id); hsWa.push(r); } } idx++; }
      } catch {}
    }

    // 4) Construir el corpus de texto para la IA
    const notasCorpus: string[] = [];
    for (const c of (callsView ?? [])) {
      const nota = String((c as any).nota ?? "").trim();
      if (!nota) continue;
      const when = (c as any).hs_timestamp ? new Date((c as any).hs_timestamp).toLocaleDateString("es-ES") : "";
      const dir = (c as any).direccion ?? "";
      const res = (c as any).resultado ?? "";
      notasCorpus.push(`[LLAMADA ${when} · ${dir} · ${res}] ${nota.slice(0, 1200)}`);
    }
    for (const n of hsNotes) {
      const when = (n as any).hs_timestamp ? new Date((n as any).hs_timestamp).toLocaleDateString("es-ES") : "";
      const body = stripHtml((n as any).hs_note_body).slice(0, 1200);
      if (body) notasCorpus.push(`[NOTA HS ${when}] ${body}`);
    }
    for (const w of hsWa) {
      const when = (w as any).hs_timestamp ? new Date((w as any).hs_timestamp).toLocaleDateString("es-ES") : "";
      const body = stripHtml((w as any).hs_communication_body).slice(0, 600);
      if (body) notasCorpus.push(`[WHATSAPP ${when}] ${body}`);
    }

    const emptyResult = {
      total: KPIS.length,
      completados: 0,
      kpis: KPIS.map((k) => ({ clave: k.clave, label: k.label, estado: "falta" as const, evidencia: null })),
      a_abordar: ["cuadro_rentas", "predisposicion", "tipologia"],
    };

    if (notasCorpus.length === 0) {
      return new Response(JSON.stringify(emptyResult), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify(emptyResult), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sys = `Eres un analista de originación inmobiliaria. Recibes las NOTAS reales de las llamadas y comunicaciones con un propietario, y una LISTA DE KPIs. Debes clasificar CADA KPI en:
- "tenemos": SOLO si hay evidencia textual clara en las notas. Devuelve una cita textual breve (≤180 caracteres) en "evidencia".
- "a_medias": hay indicio parcial pero no confirmado.
- "falta": no hay información en las notas.

No inventes. Si no aparece, es "falta". Después elige 3-5 KPIs "a_abordar" en la próxima llamada priorizando SIEMPRE "cuadro_rentas" si no está en "tenemos".`;

    const tools = [{
      type: "function",
      function: {
        name: "produce_kpis",
        description: "Clasifica los KPIs del propietario",
        parameters: {
          type: "object",
          properties: {
            kpis: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  clave: { type: "string", enum: KPIS.map((k) => k.clave) },
                  estado: { type: "string", enum: ["tenemos", "a_medias", "falta"] },
                  evidencia: { type: ["string", "null"] },
                },
                required: ["clave", "estado", "evidencia"],
                additionalProperties: false,
              },
            },
            a_abordar: { type: "array", items: { type: "string" } },
          },
          required: ["kpis", "a_abordar"],
          additionalProperties: false,
        },
      },
    }];

    const userPayload = {
      propietario: { nombre: owner?.nombre ?? null, rol: owner?.rol ?? null },
      kpis: KPIS.map((k) => ({ clave: k.clave, label: k.label, prioridad: !!k.prioridad })),
      notas: notasCorpus.slice(0, 40),
    };

    const OR_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";
    type Provider = { name: string; url: string; auth: string; model: string; extraHeaders?: Record<string,string> };
    const providers: Provider[] = [];
    if (OR_KEY) providers.push({
      name: "openrouter", url: OPENROUTER_URL, auth: `Bearer ${OR_KEY}`, model: LUNA_MODEL,
      extraHeaders: { "HTTP-Referer": "https://affluxosv2.world", "X-Title": "Afflux OS · KPI Checklist" },
    });
    providers.push({ name: "lovable", url: LOVABLE_URL, auth: `Bearer ${apiKey}`, model: FALLBACK_MODEL });
    async function callProvider(p: Provider) {
      return fetch(p.url, {
        method: "POST",
        headers: { Authorization: p.auth, "Content-Type": "application/json", ...(p.extraHeaders ?? {}) },
        body: JSON.stringify({
          model: p.model,
          messages: [
            { role: "system", content: sys },
            { role: "user", content: JSON.stringify(userPayload) },
          ],
          tools,
          tool_choice: { type: "function", function: { name: "produce_kpis" } },
        }),
      });
    }
    let aiRes: Response | null = null;
    for (const p of providers) {
      const r = await callProvider(p);
      if (r.ok) { aiRes = r; break; }
      const txt = await r.text();
      console.error(`agent_kpi_checklist provider fail ${p.name}/${p.model} status=${r.status} body=${txt.slice(0,300)}`);
      aiRes = r;
    }
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      console.error("agent_kpi_checklist AI error", aiRes.status, txt);
      return new Response(JSON.stringify(emptyResult), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiJson = await aiRes.json();
    const call = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    const parsed = JSON.parse(call?.function?.arguments ?? "{}");
    const byClave = new Map<string, any>();
    for (const k of (parsed.kpis ?? [])) byClave.set(k.clave, k);

    const kpis = KPIS.map((k) => {
      const m = byClave.get(k.clave);
      const estado = m?.estado === "tenemos" || m?.estado === "a_medias" || m?.estado === "falta" ? m.estado : "falta";
      const evidencia = estado === "tenemos" ? (typeof m?.evidencia === "string" ? m.evidencia.slice(0, 240) : null) : null;
      return { clave: k.clave, label: k.label, estado, evidencia };
    });
    const completados = kpis.filter((k) => k.estado === "tenemos").length;

    // a_abordar: prioriza cuadro_rentas si no lo tenemos
    const validClaves = new Set(KPIS.map((k) => k.clave));
    let aAbordar = (parsed.a_abordar ?? []).filter((c: string) => validClaves.has(c));
    const cuadroEstado = kpis.find((k) => k.clave === "cuadro_rentas")?.estado;
    if (cuadroEstado !== "tenemos") {
      aAbordar = ["cuadro_rentas", ...aAbordar.filter((c: string) => c !== "cuadro_rentas")];
    }
    // Rellena hasta 3 con KPIs faltantes si viene corto
    if (aAbordar.length < 3) {
      for (const k of kpis) {
        if (aAbordar.length >= 5) break;
        if (k.estado !== "tenemos" && !aAbordar.includes(k.clave)) aAbordar.push(k.clave);
      }
    }
    aAbordar = aAbordar.slice(0, 5);

    return new Response(JSON.stringify({
      total: KPIS.length,
      completados,
      kpis,
      a_abordar: aAbordar,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("agent_kpi_checklist error", e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});