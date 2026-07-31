// notas_por_deal_gemelo — recupera notas simples que viven en un deal DUPLICADO
// de HubSpot (mismo edificio, dos negocios). Para cada edificio sin notas_simples
// busca deals "gemelos" por dealname normalizado (calle + número) y, si el gemelo
// tiene notas con adjunto PDF, lo descarga e inserta en notas_simples con el
// building_id de NUESTRO edificio.
//
// Log: hubspot_sync_log.entity = 'notas_por_deal_gemelo'
// Registro: tabla public.deals_gemelos

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { hubspotFetch, corsHeaders } from "../_shared/hubspot.ts";

const ENTITY = "notas_por_deal_gemelo";
const TIME_BUDGET_MS = 110_000;

const STOP = new Set([
  "calle", "c", "avenida", "avda", "av", "paseo", "pso", "plaza", "pza", "pl",
  "ronda", "camino", "carretera", "ctra", "travesia", "glorieta", "pasaje",
  "de", "del", "la", "el", "los", "las", "y",
]);

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Devuelve "callenormalizada|numero" o null si no hay número reconocible. */
function normalizeAddress(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = stripAccents(String(input)).toLowerCase();
  // corta apellidos/detalles tras guión o coma con piso
  s = s.split(" - ")[0];
  s = s.replace(/[.,;:()]/g, " ").replace(/\s+/g, " ").trim();
  const tokens = s.split(" ").filter(Boolean);
  const words: string[] = [];
  let num: string | null = null;
  for (const t of tokens) {
    const m = t.match(/^(\d{1,4})(?:[a-z]?)$/);
    if (m) {
      if (num == null) num = String(Number(m[1]));
      continue;
    }
    if (STOP.has(t)) continue;
    if (num != null) break; // lo que viene tras el número (piso, nombre) se ignora
    words.push(t.replace(/[^a-z0-9]/g, ""));
  }
  if (!words.length || num == null) return null;
  return `${words.join("")}|${num}`;
}

function splitAttachmentIds(v: unknown): string[] {
  if (v == null) return [];
  return String(v).split(/[;,]/).map((s) => s.trim()).filter(Boolean);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }
  const maxBuildings: number = Math.max(1, Math.min(500, Number(body.limit ?? 300)));
  const dryRun: boolean = body.dry_run === true;

  const t0 = Date.now();
  const { data: logRow } = await sb.from("hubspot_sync_log")
    .insert({ entity: ENTITY, status: "running", metadatos: { dry_run: dryRun } })
    .select("id").single();
  const logId = logRow?.id;

  let gemelosDetectados = 0;
  let notasInsertadas = 0;
  let edificiosRevisados = 0;
  let errores = 0;
  const ejemplos: any[] = [];

  try {
    // 1) Edificios sin ninguna nota simple
    const { data: buildings, error: bErr } = await sb
      .from("buildings")
      .select("id, direccion, notas_simples(id)")
      .limit(2000);
    if (bErr) throw bErr;
    const sinNota = (buildings ?? []).filter(
      (b: any) => !Array.isArray(b.notas_simples) || b.notas_simples.length === 0,
    ).slice(0, maxBuildings);

    // 2) Mapa de deals conocidos (hs_id -> dealname) y de nuestros deals mapeados
    const { data: deals } = await sb.from("hubspot_deals").select("hs_id, dealname").limit(20000);
    const byKey = new Map<string, Array<{ hs_id: string; dealname: string }>>();
    for (const d of deals ?? []) {
      const k = normalizeAddress((d as any).dealname);
      if (!k) continue;
      const arr = byKey.get(k) ?? [];
      arr.push({ hs_id: String((d as any).hs_id), dealname: String((d as any).dealname ?? "") });
      byKey.set(k, arr);
    }

    const ids = sinNota.map((b: any) => b.id);
    const nuestros = new Map<string, string>(); // building_id -> hs_deal_id
    for (let i = 0; i < ids.length; i += 200) {
      const { data: ext } = await sb.from("external_ids")
        .select("entity_id, provider_id")
        .eq("entity_type", "building").eq("provider", "hubspot")
        .in("entity_id", ids.slice(i, i + 200));
      for (const e of ext ?? []) nuestros.set(String((e as any).entity_id), String((e as any).provider_id));
    }

    for (const b of sinNota) {
      if (Date.now() - t0 > TIME_BUDGET_MS) break;
      edificiosRevisados++;
      const key = normalizeAddress((b as any).direccion);
      if (!key) continue;
      const nuestro = nuestros.get(String((b as any).id)) ?? null;
      const candidatos = (byKey.get(key) ?? []).filter((d) => d.hs_id !== nuestro);
      if (!candidatos.length) continue;

      for (const gem of candidatos) {
        if (Date.now() - t0 > TIME_BUDGET_MS) break;
        gemelosDetectados++;
        let recuperadas = 0;
        try {
          // Notas asociadas al deal gemelo
          const assoc = await hubspotFetch(`/crm/v4/objects/deals/${gem.hs_id}/associations/notes?limit=100`);
          const noteIds: string[] = (assoc?.results ?? [])
            .map((r: any) => String(r?.toObjectId ?? r?.id ?? ""))
            .filter(Boolean);

          for (const noteId of noteIds) {
            if (Date.now() - t0 > TIME_BUDGET_MS) break;
            const note = await hubspotFetch(
              `/crm/v3/objects/notes/${noteId}?properties=hs_attachment_ids,hs_createdate`,
            );
            const fileIds = splitAttachmentIds(note?.properties?.hs_attachment_ids);
            if (!fileIds.length) continue;

            for (const fileId of fileIds) {
              const objectPath = `hs_${fileId}.pdf`;
              const { data: yaHay } = await sb.from("notas_simples")
                .select("id, building_id").eq("file_url", objectPath).maybeSingle();
              if (yaHay) {
                // Existe pero huérfana: la reasignamos a nuestro edificio.
                if (!(yaHay as any).building_id && !dryRun) {
                  await sb.from("notas_simples")
                    .update({ building_id: (b as any).id })
                    .eq("id", (yaHay as any).id);
                  recuperadas++;
                }
                continue;
              }
              if (dryRun) { recuperadas++; continue; }

              const meta = await hubspotFetch(`/files/v3/files/${fileId}`);
              if (String(meta?.extension ?? "").toLowerCase() !== "pdf") continue;
              let signed: any = null;
              try { signed = await hubspotFetch(`/files/v3/files/${fileId}/signed-url`); } catch { /* fallback */ }
              const url: string | undefined = signed?.url ?? meta?.url;
              if (!url) continue;
              const r = await fetch(url);
              if (!r.ok) continue;
              const pdfBytes = new Uint8Array(await r.arrayBuffer());
              const { error: upErr } = await sb.storage.from("notas-simples")
                .upload(objectPath, pdfBytes, { contentType: "application/pdf", upsert: true });
              if (upErr) continue;
              const { error: insErr } = await sb.from("notas_simples").insert({
                file_url: objectPath,
                status: "listo",
                building_id: (b as any).id,
                structured_json: {
                  needs_extract: "1",
                  origen: "deal_gemelo",
                  hs_note_id: noteId,
                  hs_file_id: fileId,
                  hs_deal_gemelo: gem.hs_id,
                },
              });
              if (insErr) continue;
              recuperadas++;
              notasInsertadas++;
            }
          }
        } catch (e: any) {
          errores++;
          console.warn(`[gemelo] deal ${gem.hs_id}: ${String(e?.message ?? e).slice(0, 200)}`);
        }

        if (!dryRun) {
          await sb.from("deals_gemelos").upsert({
            building_id: (b as any).id,
            hs_deal_nuestro: nuestro,
            hs_deal_gemelo: gem.hs_id,
            dealname: gem.dealname,
            notas_recuperadas: recuperadas,
          }, { onConflict: "building_id,hs_deal_gemelo" });
        }
        if (ejemplos.length < 20) {
          ejemplos.push({ direccion: (b as any).direccion, nuestro, gemelo: gem.hs_id, recuperadas });
        }
      }
    }

    const finishedAt = new Date().toISOString();
    const resumen = {
      edificios_revisados: edificiosRevisados,
      gemelos_detectados: gemelosDetectados,
      notas_insertadas: notasInsertadas,
      errores,
      ejemplos,
      dry_run: dryRun,
      elapsed_ms: Date.now() - t0,
    };
    await sb.from("hubspot_sync_log").update({
      finished_at: finishedAt, status: "ok",
      records_upserted: notasInsertadas, records_failed: errores,
      metadatos: resumen,
    }).eq("id", logId);

    return new Response(JSON.stringify({ ok: true, ...resumen }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    console.error(`[${ENTITY}] error: ${msg}`);
    await sb.from("hubspot_sync_log").update({
      finished_at: new Date().toISOString(), status: "error",
      records_upserted: notasInsertadas, error_message: msg,
      metadatos: { edificios_revisados: edificiosRevisados, gemelos_detectados: gemelosDetectados, ejemplos },
    }).eq("id", logId);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});