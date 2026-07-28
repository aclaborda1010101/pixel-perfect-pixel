// remap_dangling_deals — reasocia deals de HubSpot cuyos edificios fueron
// borrados (registrados en _a1_dangling) al edificio actual que corresponda
// por dirección normalizada. Los deals con confianza alta se remapean en
// external_ids; los dudosos se anotan en _a1_dangling_review.
//
// Al terminar, lanza SELECT auto_link_owner_building(3650) para reconstruir
// vínculos históricos y rescorear.
//
// Params: { dry_run?: boolean, min_confidence?: number (default 0.85), reset_review?: boolean }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { hubspotFetch, corsHeaders } from "../_shared/hubspot.ts";

function normalizeDireccion(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // sin acentos
    .replace(/^(calle|c\.|c\/|avda\.|avenida|av\.|plaza|pza\.|paseo|po\.|p\.|ronda|rda\.|travesia|trav\.|carretera|ctra\.|glorieta|glta\.|camino|cno\.)\s+/i, "")
    .replace(/[.,;]/g, " ")
    .replace(/\s+n[uú]?m?\.?\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCalleNumero(dir: string): { calle: string; numero: string | null } {
  const norm = normalizeDireccion(dir);
  const m = norm.match(/^(.+?)\s+(\d+[a-z]?)(?:\s|$)/);
  if (m) return { calle: m[1].trim(), numero: m[2] };
  return { calle: norm, numero: null };
}

function keyFor(dir: string): string {
  const { calle, numero } = extractCalleNumero(dir);
  return numero ? `${calle}|${numero}` : `${calle}|?`;
}

async function ensureReviewTable(sb: any) {
  // best-effort: la tabla debe existir ya vía migración
  return sb.from("_a1_dangling_review").select("hs_deal", { count: "exact", head: true }).limit(1);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const SUP = Deno.env.get("SUPABASE_URL")!;
  const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUP, SR);
  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }
  const dryRun: boolean = body.dry_run === true;
  const resetReview: boolean = body.reset_review === true;

  const t0 = Date.now();

  await ensureReviewTable(sb);
  if (resetReview && !dryRun) {
    await sb.from("_a1_dangling_review").delete().neq("hs_deal", "");
  }

  // 1) Cargar edificios actuales indexados por clave normalizada
  const byKey = new Map<string, { building_id: string; direccion: string }[]>();
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from("buildings")
        .select("id, direccion")
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || !data.length) break;
      for (const b of data) {
        if (!b.direccion) continue;
        const k = keyFor(String(b.direccion));
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k)!.push({ building_id: String(b.id), direccion: String(b.direccion) });
      }
      if (data.length < PAGE) break;
    }
  }

  // 2) Cargar deals colgando
  const { data: dangling, error: dErr } = await sb.from("_a1_dangling").select("hs_deal");
  if (dErr) return new Response(JSON.stringify({ ok: false, error: dErr.message }), { status: 500, headers: corsHeaders });
  const dealIds: string[] = (dangling || []).map((r: any) => String(r.hs_deal)).filter(Boolean);

  let remapped = 0, review = 0, notFound = 0, hsFail = 0;
  const reviewRows: any[] = [];
  const updates: { hs_deal: string; building_id: string; confidence: number }[] = [];

  const CONC = 6;
  let idx = 0;
  const worker = async () => {
    while (idx < dealIds.length) {
      const i = idx++;
      const dealId = dealIds[i];
      let hs: any = null;
      try {
        hs = await hubspotFetch(`/crm/v3/objects/deals/${dealId}?properties=dealname,address`);
      } catch { hsFail++; continue; }
      const dealname = String(hs?.properties?.dealname ?? "").trim();
      const address = String(hs?.properties?.address ?? "").trim();
      const raw = address || dealname;
      if (!raw) { notFound++; reviewRows.push({ hs_deal: dealId, dealname, address, candidato: null, motivo: "sin_direccion" }); continue; }

      const { calle, numero } = extractCalleNumero(raw);
      const k = numero ? `${calle}|${numero}` : `${calle}|?`;
      const candidates = byKey.get(k) || [];

      if (candidates.length === 1 && numero) {
        updates.push({ hs_deal: dealId, building_id: candidates[0].building_id, confidence: 0.95 });
        remapped++;
      } else if (candidates.length > 1 && numero) {
        review++;
        reviewRows.push({ hs_deal: dealId, dealname, address, candidato: candidates[0].building_id, motivo: `ambiguo:${candidates.length}` });
      } else if (!numero) {
        // sin número: solo dejar review, nunca autoconfianza
        const soft = byKey.get(k) || [];
        review++;
        reviewRows.push({ hs_deal: dealId, dealname, address, candidato: soft[0]?.building_id ?? null, motivo: "sin_numero" });
      } else {
        notFound++;
        reviewRows.push({ hs_deal: dealId, dealname, address, candidato: null, motivo: "sin_match" });
      }
    }
  };
  await Promise.all(Array.from({ length: CONC }, () => worker()));

  if (!dryRun) {
    // Insertar review
    if (reviewRows.length) {
      const CHUNK = 500;
      for (let i = 0; i < reviewRows.length; i += CHUNK) {
        const chunk = reviewRows.slice(i, i + CHUNK);
        await sb.from("_a1_dangling_review").upsert(chunk, { onConflict: "hs_deal" });
      }
    }
    // Aplicar remap con confianza alta
    for (const u of updates) {
      const { error } = await sb.from("external_ids")
        .update({ entity_id: u.building_id })
        .eq("provider", "hubspot").eq("entity_type", "building").eq("provider_id", u.hs_deal);
      if (error) console.error(`[remap_dangling] update fail ${u.hs_deal}: ${error.message}`);
    }
  }

  // 3) Encadenar auto_link_owner_building
  let autoLink: any = null;
  if (!dryRun && updates.length) {
    try {
      const { data, error } = await sb.rpc("auto_link_owner_building", { p_days: 3650 });
      autoLink = error ? { error: error.message } : data;
    } catch (e: any) { autoLink = { error: String(e?.message ?? e) }; }
  }

  return new Response(JSON.stringify({
    ok: true, dry_run: dryRun,
    total_deals: dealIds.length,
    remapped, review, not_found: notFound, hs_fail: hsFail,
    auto_link_result: autoLink,
    elapsed_ms: Date.now() - t0,
  }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});