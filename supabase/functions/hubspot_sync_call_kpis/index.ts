// hubspot_sync_call_kpis — vuelca a HubSpot el cierre de una sesión del copiloto
// de llamada: crea/actualiza una nota engagement con resumen + checklist + Voss
// post asociada al contacto, intenta actualizar propiedades custom afflux_* del
// contacto y mueve hs_lead_status según el outcome.
//
// Idempotente: el id de la nota se guarda en external_ids
// (entity_type='call_session', provider_object_type='note').
//
// Fallback silencioso: si no hay contact_id de HubSpot, devuelve
// { ok:false, reason:'no_hs_contact' } sin error para no romper el cierre.
//
// Propiedades opcionales en HubSpot (se detectan al vuelo; si no existen, se
// reportan en `missing_properties` y NO se intenta crearlas automáticamente):
//   afflux_tipologia                · single-line text
//   afflux_motivacion               · multi-line text
//   afflux_tecnica_score            · number (0-100)
//   afflux_ultima_llamada_at        · date (ms since epoch como string)
//   afflux_canal_abierto            · single checkbox / enum si/no
//   afflux_info_edificio_capturada  · single checkbox / enum si/no

import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, hubspotFetch } from "../_shared/hubspot.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const AFFLUX_PROPS = [
  "afflux_tipologia",
  "afflux_motivacion",
  "afflux_tecnica_score",
  "afflux_ultima_llamada_at",
  "afflux_canal_abierto",
  "afflux_info_edificio_capturada",
] as const;

// session.resultado / voss.outcome → hs_lead_status (valores estándar HubSpot)
function resolveLeadStatus(args: {
  resultado?: string | null;
  vossOutcome?: string | null;
  reunionCerrada: boolean;
  puntuacion: number;
}): string | null {
  if (args.reunionCerrada) return "CONNECTED";
  const r = (args.resultado ?? "").toLowerCase();
  if (r === "interesado") return "CONNECTED";
  if (r === "no_interesa") return "UNQUALIFIED";
  if (r === "volver") return "IN_PROGRESS";
  if (r === "no_contesta") return "ATTEMPTED_TO_CONTACT";
  if (args.puntuacion >= 70) return "CONNECTED";
  if (args.puntuacion > 0) return "IN_PROGRESS";
  return null;
}

function renderNoteBody(args: {
  ownerName: string | null;
  phone: string | null;
  buildingDireccion: string | null;
  resultado: string | null;
  objetivo: string | null;
  puntuacion: number;
  voss: any;
  checklist: any[];
  reunionCerrada: boolean;
  whatsappEnviado: boolean;
  pixelEnviado: boolean;
}) {
  const v = args.voss ?? {};
  const lines: string[] = [];
  lines.push(`<b>Afflux · Copiloto llamada · ${args.ownerName ?? args.phone ?? "(sin nombre)"}</b>`);
  if (args.buildingDireccion) lines.push(`Edificio: ${args.buildingDireccion}`);
  lines.push(
    `Resultado: <b>${args.resultado ?? "—"}</b> · Objetivo: <b>${args.objetivo ?? "—"}</b> · Score IA: <b>${args.puntuacion}/100</b>`,
  );
  const flags: string[] = [];
  if (args.reunionCerrada) flags.push("reunión_cerrada");
  if (args.whatsappEnviado) flags.push("whatsapp_enviado");
  if (args.pixelEnviado) flags.push("pixel_enviado");
  if (flags.length) lines.push(`Flags KPI: <b>${flags.join(", ")}</b>`);
  lines.push("");
  if (v?.puntuacion?.justificacion) {
    lines.push("<b>Resumen IA</b>");
    lines.push(String(v.puntuacion.justificacion));
    lines.push("");
  }
  if (Array.isArray(args.checklist) && args.checklist.length) {
    lines.push("<b>Checklist</b>");
    for (const c of args.checklist) {
      const ok = c?.done ? "✅" : "⬜";
      const ev = c?.evidencia ? ` — <i>"${String(c.evidencia).slice(0, 200)}"</i>` : "";
      lines.push(`${ok} ${c?.label ?? c?.k ?? ""}${ev}`);
    }
    lines.push("");
  }
  if (v?.proxima_accion) {
    lines.push(`<b>Próxima acción:</b> ${String(v.proxima_accion)}`);
  }
  if (Array.isArray(v?.sacar_en_siguiente_contacto) && v.sacar_en_siguiente_contacto.length) {
    lines.push(`<b>Sacar próximo contacto:</b> ${v.sacar_en_siguiente_contacto.join(" · ")}`);
  }
  lines.push("");
  lines.push(`<i>Sincronizado automáticamente desde Afflux · ${new Date().toISOString()}</i>`);
  return lines.join("<br>");
}

// Lee qué propiedades afflux_* existen ya en HubSpot.
async function detectAffluxProps(): Promise<{ existing: Set<string>; missing: string[] }> {
  try {
    const list = await hubspotFetch("/crm/v3/properties/contacts");
    const names = new Set<string>(
      Array.isArray(list?.results) ? list.results.map((p: any) => p?.name).filter(Boolean) : [],
    );
    const existing = new Set<string>();
    const missing: string[] = [];
    for (const p of AFFLUX_PROPS) {
      if (names.has(p)) existing.add(p); else missing.push(p);
    }
    return { existing, missing };
  } catch (e) {
    console.warn("[hubspot_sync_call_kpis] no se pudo listar properties", (e as any)?.message);
    return { existing: new Set(), missing: [...AFFLUX_PROPS] };
  }
}

function pickTipologia(voss: any, ownerBuyerPersona: any): string | null {
  return (
    voss?.tipologia ??
    voss?.checklist?.tipologia_capturada?.valor ??
    voss?.checklist?.tipologia_capturada?.evidencia ??
    ownerBuyerPersona ??
    null
  );
}

function pickMotivacion(voss: any, checklist: any[]): string | null {
  const fromVoss = voss?.motor ?? voss?.motivacion ?? voss?.checklist?.motor_capturado?.evidencia;
  if (fromVoss) return String(fromVoss);
  const motor = (checklist ?? []).find((c) => c?.k === "motor");
  return motor?.evidencia ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { session_id } = await req.json();
    if (!session_id) throw new Error("session_id requerido");

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: session, error: sErr } = await admin
      .from("call_sessions")
      .select("id, owner_id, building_id, call_id, objetivo, resultado, puntuacion, voss_post, checklist, finalizada_at, cerrada_at")
      .eq("id", session_id)
      .maybeSingle();
    if (sErr) throw sErr;
    if (!session) throw new Error("session no encontrada");
    if (!session.owner_id) {
      return new Response(JSON.stringify({ ok: false, reason: "no_owner" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Owner + building (opcional para enriquecer la nota)
    const [{ data: owner }, { data: building }] = await Promise.all([
      admin.from("owners").select("id, nombre, telefono, buyer_persona").eq("id", session.owner_id).maybeSingle(),
      session.building_id
        ? admin.from("buildings").select("id, direccion, ciudad").eq("id", session.building_id).maybeSingle()
        : Promise.resolve({ data: null } as any),
    ]);

    // Flags KPI tal y como los acabamos de escribir en finalize_call_session
    let whatsappEnviado = false, pixelEnviado = false, reunionCerrada = false;
    if (session.call_id) {
      const { data: c } = await admin.from("calls")
        .select("metadatos").eq("id", session.call_id).maybeSingle();
      const m = (c?.metadatos ?? {}) as Record<string, unknown>;
      whatsappEnviado = m?.whatsapp_enviado === true;
      pixelEnviado = m?.pixel_enviado === true;
      reunionCerrada = m?.reunion_cerrada === true;
    }

    // Resolver hubspot contact id vía owner → external_ids
    const { data: ext } = await admin.from("external_ids")
      .select("provider_id")
      .eq("entity_type", "owner").eq("entity_id", session.owner_id)
      .eq("provider", "hubspot").eq("provider_object_type", "contact")
      .maybeSingle();
    const hsContactId = ext?.provider_id ?? null;
    if (!hsContactId) {
      return new Response(JSON.stringify({ ok: false, reason: "no_hs_contact", owner_id: session.owner_id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const puntuacion = Number(session.puntuacion ?? 0) || 0;
    const voss = session.voss_post ?? {};
    const checklist = Array.isArray(session.checklist) ? session.checklist : [];
    const canalAbierto = !!checklist.find((c: any) => c?.k === "canal_abierto" && c?.done);
    const infoEdificio = !!checklist.find((c: any) => c?.k === "info_edificio" && c?.done);
    const tipologia = pickTipologia(voss, (owner as any)?.buyer_persona);
    const motivacion = pickMotivacion(voss, checklist);

    // ── Note engagement ─────────────────────────────────────────────────────
    const body = renderNoteBody({
      ownerName: (owner as any)?.nombre ?? null,
      phone: (owner as any)?.telefono ?? null,
      buildingDireccion: (building as any)?.direccion ?? null,
      resultado: (session as any).resultado ?? null,
      objetivo: (session as any).objetivo ?? null,
      puntuacion,
      voss,
      checklist,
      reunionCerrada,
      whatsappEnviado,
      pixelEnviado,
    });

    const { data: noteExt } = await admin.from("external_ids")
      .select("provider_id")
      .eq("entity_type", "call_session").eq("entity_id", session_id)
      .eq("provider", "hubspot").eq("provider_object_type", "note")
      .maybeSingle();

    let noteId: string | null = noteExt?.provider_id ?? null;
    if (noteId) {
      try {
        await hubspotFetch(`/crm/v3/objects/notes/${noteId}`, {
          method: "PATCH",
          body: JSON.stringify({ properties: { hs_note_body: body, hs_timestamp: String(Date.now()) } }),
        });
      } catch (e) {
        console.warn("[hubspot_sync_call_kpis] patch note failed, recreating", (e as any)?.message);
        noteId = null;
      }
    }
    if (!noteId) {
      const created = await hubspotFetch("/crm/v3/objects/notes", {
        method: "POST",
        body: JSON.stringify({ properties: { hs_note_body: body, hs_timestamp: String(Date.now()) } }),
      });
      noteId = created?.id ?? null;
      if (noteId) {
        // Asociar nota ↔ contacto (associationTypeId 202 = note→contact).
        await hubspotFetch(`/crm/v4/objects/notes/${noteId}/associations/contacts/${hsContactId}`, {
          method: "PUT",
          body: JSON.stringify([{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }]),
        }).catch((e) => console.warn("[hubspot_sync_call_kpis] assoc note→contact", (e as any)?.message));
        await admin.from("external_ids").upsert({
          entity_type: "call_session", entity_id: session_id,
          provider: "hubspot", provider_object_type: "note", provider_id: noteId,
        }, { onConflict: "entity_type,entity_id,provider,provider_object_type" });
      }
    }

    // ── Propiedades custom del contacto ─────────────────────────────────────
    const { existing, missing } = await detectAffluxProps();
    const ultimaLlamadaAt =
      (session as any).finalizada_at ?? (session as any).cerrada_at ?? new Date().toISOString();
    const candidates: Record<string, string | number | null> = {
      afflux_tipologia: tipologia ? String(tipologia).slice(0, 250) : null,
      afflux_motivacion: motivacion ? String(motivacion).slice(0, 1500) : null,
      afflux_tecnica_score: puntuacion || null,
      afflux_ultima_llamada_at: ultimaLlamadaAt ? String(new Date(ultimaLlamadaAt).getTime()) : null,
      afflux_canal_abierto: canalAbierto ? "si" : "no",
      afflux_info_edificio_capturada: infoEdificio ? "si" : "no",
    };
    const toPatch: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(candidates)) {
      if (v == null || v === "") continue;
      if (existing.has(k)) toPatch[k] = v;
    }

    // hs_lead_status va siempre (es estándar HubSpot, no requiere setup).
    const hsStatus = resolveLeadStatus({
      resultado: (session as any).resultado,
      vossOutcome: voss?.outcome,
      reunionCerrada,
      puntuacion,
    });
    if (hsStatus) toPatch["hs_lead_status"] = hsStatus;

    if (Object.keys(toPatch).length) {
      try {
        await hubspotFetch(`/crm/v3/objects/contacts/${hsContactId}`, {
          method: "PATCH",
          body: JSON.stringify({ properties: toPatch }),
        });
      } catch (e) {
        console.warn("[hubspot_sync_call_kpis] patch contact properties", (e as any)?.message);
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      hs_contact_id: hsContactId,
      note_id: noteId,
      hs_lead_status: hsStatus,
      updated_properties: Object.keys(toPatch),
      missing_properties: missing, // propiedades afflux_* aún no creadas en HubSpot
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[hubspot_sync_call_kpis] error", e);
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});