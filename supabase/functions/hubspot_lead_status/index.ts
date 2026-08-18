// hubspot_lead_status — puesta al día del ESTADO DE CICLO de contactos en HubSpot.
//
// ALCANCE ESTRICTO: sólo la propiedad hs_lead_status de contactos con llamada real
// registrada en la aplicación. NO escribe campos comerciales ni depende del
// interruptor general 'hubspot_escritura_activada' (que sigue apagado).
//
// Acciones:
//   plan   → selecciona candidatas y describe el portal. CERO escrituras.
//   apply  → aplica por lotes de 100 (lectura por lotes + actualización por lotes).
//   verify → relee una muestra de contactos en HubSpot.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, hubspotFetch } from "../_shared/hubspot.ts";
import {
  ETIQUETA_OBJETIVO,
  decidirLeadStatus,
  lotes,
  normalizar,
  ordenarOpciones,
  type OpcionPortal,
} from "../_shared/hubspotWrite/leadStatus.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const TAM_LOTE = 100; // límite de la API de lotes de HubSpot

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Candidata = { id: string; owner_id: string; contact_id: string };

async function opcionesLeadStatus(): Promise<OpcionPortal[]> {
  const p = await hubspotFetch("/crm/v3/properties/contacts/hs_lead_status");
  const ops: OpcionPortal[] = (p?.options ?? []).map((o: any) => ({
    label: String(o.label), value: String(o.value), displayOrder: Number(o.displayOrder ?? 0),
  }));
  return ordenarOpciones(ops);
}

/** Candidatas: guarda 1 pendiente + contacto de HubSpot + llamada real. */
async function seleccionar(sb: any) {
  const validas: Candidata[] = [];
  const descartadas: { id: string; motivo: string }[] = [];
  let desde = 0;
  for (;;) {
    const { data, error } = await sb.from("guard_proposals")
      .select("id,propuesta")
      .eq("guarda", 1).eq("estado", "pendiente")
      .order("creado_at").range(desde, desde + 499);
    if (error) throw new Error(error.message);
    const filas = data ?? [];
    if (filas.length === 0) break;
    for (const f of filas) {
      const p = (f.propuesta ?? {}) as Record<string, unknown>;
      const ownerId = p.owner_id ? String(p.owner_id) : "";
      const contactId = p.hs_contact_id ? String(p.hs_contact_id) : "";
      if (String(p.accion ?? "") !== "patch_contact" || String(p.campo ?? "") !== "hs_lead_status") {
        descartadas.push({ id: f.id, motivo: "propuesta_no_es_estado_de_contacto" }); continue;
      }
      if (!ownerId) { descartadas.push({ id: f.id, motivo: "sin_propietario" }); continue; }
      if (!contactId) { descartadas.push({ id: f.id, motivo: "sin_contacto_en_hubspot" }); continue; }
      validas.push({ id: f.id, owner_id: ownerId, contact_id: contactId });
    }
    if (filas.length < 500) break;
    desde += 500;
  }

  // Llamada real = duración registrada o transcripción.
  const conLlamada = new Set<string>();
  const ids = [...new Set(validas.map((v) => v.owner_id))];
  for (const grupo of lotes(ids, 300)) {
    const { data } = await sb.from("calls").select("owner_id,duracion_seg,transcripcion").in("owner_id", grupo);
    for (const c of data ?? []) {
      if (Number(c.duracion_seg ?? 0) > 0 || (c.transcripcion ?? "") !== "") conLlamada.add(String(c.owner_id));
    }
  }
  const aplicables = validas.filter((v) => conLlamada.has(v.owner_id));
  for (const v of validas) {
    if (!conLlamada.has(v.owner_id)) descartadas.push({ id: v.id, motivo: "sin_llamada_real_registrada" });
  }
  return { aplicables, descartadas };
}

async function marcar(sb: any, ids: string[], estado: string, motivo: string, actor: string) {
  for (const grupo of lotes(ids, 200)) {
    await sb.from("guard_proposals").update({
      estado, motivo, resuelto_por: actor, resuelto_at: new Date().toISOString(),
      ...(estado === "aplicada" ? { aplicada_at: new Date().toISOString() } : {}),
    }).in("id", grupo);
  }
}

async function apply(sb: any, actor: string, maxLotes: number, seco: boolean) {
  const orden = await opcionesLeadStatus();
  const objetivo = orden.find((o) => normalizar(o.label) === normalizar(ETIQUETA_OBJETIVO));
  const valorObjetivo = objetivo?.value ?? null;
  if (!valorObjetivo) return { error: "el portal no tiene el estado 'Contactado'" };

  const { aplicables, descartadas } = await seleccionar(sb);
  if (!seco) {
    for (const motivo of [...new Set(descartadas.map((d) => d.motivo))]) {
      await marcar(sb, descartadas.filter((d) => d.motivo === motivo).map((d) => d.id),
        "obsoleta", `No aplicable: ${motivo}`, actor);
    }
  }

  const res = {
    candidatas: aplicables.length, no_aplicables: descartadas.length,
    aplicadas: 0, ya_resueltas: 0, fallidas: 0, lotes: 0, seco,
    errores: [] as { contacto: string; motivo: string }[],
    muestra: [] as { contacto: string; anterior: string | null; nuevo: string }[],
  };

  const grupos = lotes(aplicables, TAM_LOTE).slice(0, maxLotes);
  for (const grupo of grupos) {
    res.lotes++;
    let leidos: any;
    try {
      leidos = await hubspotFetch("/crm/v3/objects/contacts/batch/read", {
        method: "POST",
        body: JSON.stringify({ properties: ["hs_lead_status"], inputs: grupo.map((g) => ({ id: g.contact_id })) }),
      });
    } catch (e) {
      res.fallidas += grupo.length;
      res.errores.push({ contacto: `lote:${grupo[0]?.contact_id}`, motivo: (e as Error).message });
      continue;
    }
    const actual = new Map<string, string | null>();
    for (const r of leidos?.results ?? []) actual.set(String(r.id), r?.properties?.hs_lead_status ?? null);

    const aEscribir: Candidata[] = [];
    const yaResueltas: { c: Candidata; motivo: string }[] = [];
    const noAplicables: { c: Candidata; motivo: string }[] = [];
    for (const c of grupo) {
      if (!actual.has(c.contact_id)) { noAplicables.push({ c, motivo: "contacto_inexistente_en_hubspot" }); continue; }
      const d = decidirLeadStatus({ actual: actual.get(c.contact_id), orden, valorObjetivo });
      if (d.accion === "escribir") aEscribir.push(c);
      else if (d.accion === "ya_resuelto") yaResueltas.push({ c, motivo: d.motivo });
      else noAplicables.push({ c, motivo: d.motivo });
    }

    if (!seco && aEscribir.length > 0) {
      try {
        await hubspotFetch("/crm/v3/objects/contacts/batch/update", {
          method: "POST",
          body: JSON.stringify({
            inputs: aEscribir.map((c) => ({ id: c.contact_id, properties: { hs_lead_status: valorObjetivo } })),
          }),
        });
        for (const c of aEscribir) {
          const anterior = actual.get(c.contact_id) ?? null;
          if (res.muestra.length < 5) res.muestra.push({ contacto: c.contact_id, anterior, nuevo: valorObjetivo });
          await sb.from("guard_proposals").update({
            estado: "aplicada", aplicada_at: new Date().toISOString(),
            resuelto_at: new Date().toISOString(), resuelto_por: actor,
            motivo: `Estado de ciclo en HubSpot: ${anterior ?? "(vacío)"} → ${valorObjetivo}`,
          }).eq("id", c.id);
        }
        res.aplicadas += aEscribir.length;
      } catch (e) {
        res.fallidas += aEscribir.length;
        res.errores.push({ contacto: `lote:${aEscribir[0]?.contact_id}`, motivo: (e as Error).message });
      }
    } else if (seco) {
      res.aplicadas += aEscribir.length;
      for (const c of aEscribir.slice(0, Math.max(0, 5 - res.muestra.length))) {
        res.muestra.push({ contacto: c.contact_id, anterior: actual.get(c.contact_id) ?? null, nuevo: valorObjetivo });
      }
    }

    res.ya_resueltas += yaResueltas.length;
    if (!seco) {
      for (const { c, motivo } of yaResueltas) {
        await sb.from("guard_proposals").update({
          estado: "obsoleta", resuelto_at: new Date().toISOString(), resuelto_por: actor,
          motivo: `Ya resuelto en HubSpot (${motivo})`,
        }).eq("id", c.id);
      }
      for (const { c, motivo } of noAplicables) {
        await sb.from("guard_proposals").update({
          estado: "obsoleta", resuelto_at: new Date().toISOString(), resuelto_por: actor,
          motivo: `No aplicable: ${motivo}`,
        }).eq("id", c.id);
      }
    }
    res.no_aplicables += noAplicables.length;
    await new Promise((r) => setTimeout(r, 250)); // respeta los límites de la API
  }
  res.errores = res.errores.slice(0, 10);
  return res;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (token !== SERVICE_KEY) {
      if (!token) return json(401, { ok: false, error: "no_autenticado" });
      const authed = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data, error } = await authed.auth.getClaims(token);
      const uid = data?.claims?.sub;
      if (error || !uid) return json(401, { ok: false, error: "no_autenticado" });
      const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", uid);
      if (!(roles ?? []).some((r: any) => r.role === "admin")) return json(403, { ok: false, error: "solo_admin" });
    }

    let body: Record<string, unknown> = {};
    try { body = (await req.json()) ?? {}; } catch { body = {}; }
    const accion = String(body.accion ?? "plan");
    const actor = String(body.actor ?? "sistema:estado_ciclo");
    const maxLotes = Math.min(Math.max(Number(body.max_lotes ?? 4) || 4, 1), 20);

    if (accion === "plan") {
      const orden = await opcionesLeadStatus();
      const { aplicables, descartadas } = await seleccionar(sb);
      const motivos: Record<string, number> = {};
      for (const d of descartadas) motivos[d.motivo] = (motivos[d.motivo] ?? 0) + 1;
      return json(200, {
        ok: true, simulacion: true, candidatas: aplicables.length,
        no_aplicables: motivos, estados_portal: orden.map((o) => o.label),
      });
    }
    if (accion === "verify") {
      const ids = Array.isArray(body.contact_ids) ? body.contact_ids.map(String).slice(0, 20) : [];
      const leidos = await hubspotFetch("/crm/v3/objects/contacts/batch/read", {
        method: "POST",
        body: JSON.stringify({
          properties: ["hs_lead_status", "firstname", "lastname"],
          inputs: ids.map((id) => ({ id })),
        }),
      });
      return json(200, {
        ok: true,
        contactos: (leidos?.results ?? []).map((r: any) => ({
          id: r.id, nombre: `${r.properties?.firstname ?? ""} ${r.properties?.lastname ?? ""}`.trim(),
          hs_lead_status: r.properties?.hs_lead_status ?? null,
        })),
      });
    }
    if (accion !== "apply") return json(400, { ok: false, error: "accion_desconocida" });
    return json(200, { ok: true, ...(await apply(sb, actor, maxLotes, body.seco === true)) });
  } catch (e) {
    return json(500, { ok: false, error: (e as Error)?.message ?? String(e) });
  }
});
