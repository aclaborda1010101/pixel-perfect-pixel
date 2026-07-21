// link_orphan_contacts
// Auto-linker: para hs_contact_ids referenciados en calls/notes/tasks/whatsapp
// que NO tienen mapping en external_ids, intenta emparejar con un owner
// existente (email → phone → nombre similar). Si no hay match claro, cae al
// comportamiento clásico de crear owner nuevo (fallback controlado con
// `create_new_when_no_match`) o registra el contacto en `hubspot_link_review`.
//
// Params: {
//   since_days?: number,       // ventana temporal para referenciadores (default 60)
//   max_contacts?: number,     // tope de contactos a procesar por invocación (default 200)
//   min_refs?: number,         // mínimo de referencias para procesar (default 1)
//   create_new_when_no_match?: boolean (default true)
// }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { hubspotFetch, corsHeaders, CONTACT_PROPERTIES } from "../_shared/hubspot.ts";

const BATCH_READ_SIZE = 100;

function mapRol(p: Record<string, any>): string {
  const t = String(p.tipologia_de_propietario || "").toLowerCase();
  if (t.includes("inversor")) return "inversor_pasivo";
  if (t.includes("operador") || t.includes("profesional")) return "operador_profesional";
  if (t.includes("institucional")) return "institucional";
  if (t.includes("heredero")) return "heredero";
  if (t.includes("propietario") || p.dni__nif__cif) return "particular";
  return "desconocido";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any = {};
  try { body = await req.clone().json(); } catch { /* ignore */ }
  const sinceDays: number = Math.max(1, Math.min(365, Number(body.since_days ?? 60)));
  const maxContacts: number = Math.max(1, Math.min(2000, Number(body.max_contacts ?? 200)));
  const minRefs: number = Math.max(1, Number(body.min_refs ?? 1));
  const createNew: boolean = body.create_new_when_no_match !== false;

  const sinceIso = new Date(Date.now() - sinceDays * 86400_000).toISOString();

  const { data: logRow } = await supabase.from("hubspot_sync_log")
    .insert({ entity: "link_orphan_contacts", status: "running",
              metadatos: { since_iso: sinceIso, max_contacts: maxContacts } })
    .select("id").single();
  const logId = logRow?.id;

  const refMap = new Map<string, number>();
  const tables: { t: string; col: string; ts?: string }[] = [
    { t: "hubspot_calls", col: "associated_contact_ids", ts: "hs_timestamp" },
    { t: "hubspot_notes", col: "associated_contact_ids", ts: "hs_timestamp" },
    { t: "hubspot_tasks", col: "associated_contact_ids", ts: "hs_timestamp" },
    { t: "hubspot_whatsapp", col: "associated_contact_ids", ts: "hs_timestamp" },
  ];

  try {
    // 1) recopilar referencias
    for (const { t, col, ts } of tables) {
      let from = 0;
      const pageSize = 1000;
      while (true) {
        let q = supabase.from(t).select(`${col}${ts ? ","+ts : ""}`).range(from, from + pageSize - 1);
        if (ts) q = q.gte(ts, sinceIso);
        const { data, error } = await q;
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const row of data) {
          const arr: string[] = (row as any)[col] || [];
          for (const id of arr) {
            if (!id) continue;
            refMap.set(id, (refMap.get(id) || 0) + 1);
          }
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }
    }

    const allIds = Array.from(refMap.entries())
      .filter(([_, n]) => n >= minRefs)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);

    // 2) filtrar los ya mapeados
    const existing = new Set<string>();
    for (let i = 0; i < allIds.length; i += 1000) {
      const chunk = allIds.slice(i, i + 1000);
      const { data } = await supabase.from("external_ids")
        .select("provider_id")
        .eq("provider", "hubspot")
        .eq("provider_object_type", "contact")
        .in("provider_id", chunk);
      (data || []).forEach((r: any) => existing.add(r.provider_id));
    }
    const orphans = allIds.filter((id) => !existing.has(id));
    const orphanTotal = orphans.length;
    const slice = orphans.slice(0, maxContacts);

    let linked = 0, createdNew = 0, queued = 0, failed = 0, fetched = 0;
    const byMethod: Record<string, number> = { email: 0, phone: 0, name: 0 };

    for (let i = 0; i < slice.length; i += BATCH_READ_SIZE) {
      const chunk = slice.slice(i, i + BATCH_READ_SIZE);
      // Batch read HubSpot
      let results: any[] = [];
      try {
        const resp = await hubspotFetch("/crm/v3/objects/contacts/batch/read?archived=false", {
          method: "POST",
          body: JSON.stringify({
            inputs: chunk.map((id) => ({ id })),
            properties: CONTACT_PROPERTIES,
            propertiesWithHistory: [],
          }),
        });
        results = resp?.results || [];
      } catch (e) {
        console.error("[link_orphan] batch_read fail:", (e as Error).message);
        failed += chunk.length;
        continue;
      }
      fetched += results.length;

      for (const c of results) {
        const props = c.properties || {};
        const first = String(props.firstname || "").trim() || null;
        const last = String(props.lastname || "").trim() || null;
        const email = props.email ? String(props.email).trim() : null;
        const phone = props.phone ? String(props.phone).trim() : null;
        const nombre = `${first ?? ""} ${last ?? ""}`.trim() || email || "Sin nombre";

        try {
          const { data: match } = await supabase.rpc("find_owner_for_orphan_contact", {
            p_email: email, p_phone: phone, p_first: first, p_last: last,
          });
          const m = Array.isArray(match) ? match[0] : match;
          const matchedOwnerId: string | null = m?.owner_id ?? null;
          const method: string = m?.method ?? "none";

          if (matchedOwnerId) {
            const { error: extErr } = await supabase.from("external_ids").insert({
              entity_type: "owner", entity_id: matchedOwnerId,
              provider: "hubspot", provider_object_type: "contact", provider_id: String(c.id),
              metadatos: {
                hs_object_id: c.id, source: "link_orphan_contacts",
                match_method: method, confidence: m?.confidence ?? null,
              },
            });
            if (extErr) {
              // race — probablemente ya existe
              failed++;
            } else {
              linked++;
              byMethod[method] = (byMethod[method] || 0) + 1;
              // Rellenar teléfono/email si el owner los tenía vacíos
              const patch: Record<string, any> = {};
              const { data: own } = await supabase.from("owners")
                .select("email,telefono").eq("id", matchedOwnerId).single();
              if (own && !own.email && email) patch.email = email;
              if (own && !own.telefono && phone) patch.telefono = phone;
              if (Object.keys(patch).length) {
                patch.last_synced_at = new Date().toISOString();
                await supabase.from("owners").update(patch).eq("id", matchedOwnerId);
              }
            }
            continue;
          }

          // Sin match: crear owner nuevo o encolar en review
          if (createNew) {
            const { data: ins, error: insErr } = await supabase.from("owners").insert({
              nombre,
              email, telefono: phone,
              rol: mapRol(props),
              metadatos: { ...props, _hubspot_contact_id: c.id, source: "link_orphan_contacts" },
              last_synced_at: new Date().toISOString(),
            }).select("id").single();
            if (insErr || !ins) { failed++; continue; }
            const { error: extErr } = await supabase.from("external_ids").insert({
              entity_type: "owner", entity_id: ins.id,
              provider: "hubspot", provider_object_type: "contact", provider_id: String(c.id),
              metadatos: { hs_object_id: c.id, source: "link_orphan_contacts_new" },
            });
            if (extErr) {
              await supabase.from("owners").delete().eq("id", ins.id);
              failed++;
            } else {
              createdNew++;
            }
          } else {
            await supabase.from("hubspot_link_review").upsert({
              hs_contact_id: String(c.id),
              firstname: first, lastname: last, email, phone,
              refs_count: refMap.get(String(c.id)) || 0,
              status: "pending",
              reason: "no_confident_match",
              updated_at: new Date().toISOString(),
            }, { onConflict: "hs_contact_id" });
            queued++;
          }
        } catch (e) {
          console.error("[link_orphan] contact fail:", (e as Error).message);
          failed++;
        }
      }
    }

    const finishedAt = new Date().toISOString();
    await supabase.from("hubspot_sync_log").update({
      finished_at: finishedAt, status: "ok",
      pages_fetched: Math.ceil(slice.length / BATCH_READ_SIZE),
      records_upserted: linked + createdNew,
      records_failed: failed,
      metadatos: {
        since_iso: sinceIso, orphan_total: orphanTotal,
        processed: slice.length, fetched,
        linked, created_new: createdNew, queued, by_method: byMethod,
      },
    }).eq("id", logId);

    return new Response(JSON.stringify({
      ok: true, since_iso: sinceIso,
      orphan_total: orphanTotal, processed: slice.length,
      linked, created_new: createdNew, queued, failed,
      by_method: byMethod,
      remaining: Math.max(0, orphanTotal - slice.length),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    const msg = String(e?.message || e);
    console.error("[link_orphan_contacts] error:", msg);
    await supabase.from("hubspot_sync_log").update({
      finished_at: new Date().toISOString(), status: "error",
      error_message: msg,
    }).eq("id", logId);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});