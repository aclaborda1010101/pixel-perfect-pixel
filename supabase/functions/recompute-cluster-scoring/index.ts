import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Extrae señales de mala gestión / reformado / gestión profesional a partir
// de las notas, llamadas y CRM (HubSpot notes + calls + buildings.notas).
async function extractCrmSignals(opts: {
  direccion: string;
  notas: string[];
}) {
  const ctx = opts.notas.filter(Boolean).slice(0, 25).join("\n---\n").slice(0, 12000);
  if (!ctx.trim()) return null;

  const prompt = `Eres un analista inmobiliario. Lee este contexto CRM de un edificio en Madrid y extrae señales operativas para scoring.

CONTEXTO CRM (notas, llamadas, comentarios):
${ctx}

Devuelve JSON estricto con estas claves:
{
  "mala_gestion_score": 0-10,  // 0 = todo perfecto / sin info, 10 = conflicto extremo + propietarios cansados + contratos caóticos + impagos + ITE/derramas pendientes
  "evidencias": ["frase corta 1", "frase corta 2"],
  "edificio_reformado": true/false,  // true SOLO si hay evidencia de reforma integral reciente (<5 años)
  "gestion_profesional": true/false  // true si lo gestiona patrimonialista profesional / SOCIMI / family office estructurado
}
Si no hay información para una clave, usa null. Devuelve SOLO el JSON.`;

  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) {
      console.warn("LLM signals fail", r.status, await r.text());
      return null;
    }
    const j = await r.json();
    const raw = j?.choices?.[0]?.message?.content ?? "{}";
    return JSON.parse(raw);
  } catch (e) {
    console.warn("signals error", e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SB_URL, SB_SERVICE);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const onlySeed = body?.only_seed !== false; // default true: solo los 74
  const limit = Number(body?.limit ?? 200);
  const skipSignals = body?.skip_signals === true;

  // 1. Selección de edificios
  let q = sb.from("buildings").select("id, direccion, notas").limit(limit);
  if (onlySeed) q = q.eq("cartera_demo_seed", true);
  const { data: buildings, error } = await q;
  if (error) return json({ error: error.message }, 500);
  if (!buildings) return json({ ok: true, processed: 0 });

  const summary: Record<string, number> = {};
  let processed = 0, signalsOk = 0, signalsFail = 0;

  for (const b of buildings) {
    try {
      // 2. Señales CRM via LLM (notes hubspot + calls + buildings.notas)
      if (!skipSignals) {
        // owners del edificio
        const { data: bos } = await sb.from("building_owners").select("owner_id").eq("building_id", b.id);
        const ownerIds = (bos ?? []).map((x: any) => x.owner_id).filter(Boolean);

        const notas: string[] = [];
        if (b.notas) notas.push(b.notas);

        // notas hubspot asociadas a contactos owner (mejor esfuerzo)
        if (ownerIds.length) {
          const { data: ownersHs } = await sb
            .from("owners")
            .select("metadatos")
            .in("id", ownerIds.slice(0, 20));
          const hsContactIds = (ownersHs ?? [])
            .map((o: any) => o?.metadatos?.hs_contact_id || o?.metadatos?.hs_object_id)
            .filter(Boolean)
            .map(String);
          if (hsContactIds.length) {
            const { data: hsn } = await sb
              .from("hubspot_notes")
              .select("hs_note_body, associated_contact_ids")
              .overlaps("associated_contact_ids", hsContactIds)
              .limit(30);
            for (const n of hsn ?? []) {
              if (n?.hs_note_body) notas.push(String(n.hs_note_body).replace(/<[^>]+>/g, " ").slice(0, 800));
            }
            const { data: hsc } = await sb
              .from("hubspot_calls")
              .select("hs_call_body")
              .overlaps("associated_contact_ids", hsContactIds)
              .limit(20);
            for (const c of hsc ?? []) {
              if (c?.hs_call_body) notas.push(String(c.hs_call_body).replace(/<[^>]+>/g, " ").slice(0, 800));
            }
          }
        }

        // llamadas propias
        const { data: ourCalls } = await sb
          .from("calls")
          .select("resumen, transcripcion")
          .eq("metadatos->>building_id", b.id)
          .limit(10);
        for (const c of ourCalls ?? []) {
          if (c?.resumen) notas.push(String(c.resumen).slice(0, 800));
          if (c?.transcripcion) notas.push(String(c.transcripcion).slice(0, 1000));
        }

        const signals = await extractCrmSignals({ direccion: b.direccion, notas });
        if (signals) {
          signalsOk++;
          const patch: any = {};
          if (typeof signals.mala_gestion_score === "number") {
            patch.mala_gestion_score = Math.max(0, Math.min(10, Math.round(signals.mala_gestion_score)));
          }
          if (Array.isArray(signals.evidencias)) patch.mala_gestion_evidencias = signals.evidencias;
          if (typeof signals.edificio_reformado === "boolean") patch.edificio_reformado = signals.edificio_reformado;
          if (typeof signals.gestion_profesional === "boolean") patch.gestion_profesional = signals.gestion_profesional;

          if (Object.keys(patch).length) {
            // Upsert sobre building_analysis (existe o crea fila)
            const { data: existing } = await sb
              .from("building_analysis").select("id").eq("building_id", b.id).maybeSingle();
            if (existing) {
              await sb.from("building_analysis").update(patch).eq("building_id", b.id);
            } else {
              await sb.from("building_analysis").insert({ building_id: b.id, ...patch });
            }
          }
        } else {
          signalsFail++;
        }
      }

      // 3. Recalcular score por clusters
      const { data: score } = await sb.rpc("compute_cluster_score", { p_building_id: b.id });

      // 4. Resumen por cluster
      const { data: bRow } = await sb
        .from("buildings").select("cluster_asignado").eq("id", b.id).maybeSingle();
      const c = bRow?.cluster_asignado ?? "desconocido";
      summary[c] = (summary[c] ?? 0) + 1;
      processed++;
      console.log(`✔ ${b.direccion}: cluster=${c} score=${score}`);
    } catch (e) {
      console.error("recompute err", b.id, e);
    }
  }

  return json({ ok: true, processed, signals_ok: signalsOk, signals_fail: signalsFail, por_cluster: summary });
});