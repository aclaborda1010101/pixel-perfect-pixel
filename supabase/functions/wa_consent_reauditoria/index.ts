// wa_consent_reauditoria — pasa TODAS las señales de consentimiento y TODAS
// las llamadas que mencionan WhatsApp por las tres comprobaciones legales.
//
// Hace dos cosas:
//  A) Reaudita lo guardado: lo que no supera las comprobaciones pierde el
//     «autorizado» y queda pendiente de revisión, con el motivo escrito.
//     Lo que sí las supera vuelve a quedar autorizado y vigente.
//  B) Recupera permisos perdidos: llamadas donde el propietario pidió el
//     WhatsApp y nunca se registró. Cita literal obligatoria.
//
// Body: { limit?: number, dry_run?: boolean, solo?: 'reauditar'|'recuperar' }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import {
  detectarVeto,
  extraerCitaConsentimiento,
  validarConsentimiento,
} from "../_shared/waConsent.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const SUP = Deno.env.get("SUPABASE_URL")!;
  const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUP, SR);

  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }
  const limit = Math.max(1, Math.min(2000, Number(body.limit ?? 500)));
  const dry = !!body.dry_run;
  const solo = String(body.solo ?? "");
  const t0 = Date.now();

  const resumen: any = {
    reauditadas: 0, reaprobadas: 0, degradadas: 0,
    llamadas_revisadas: 0, recuperadas: 0, vetadas: 0,
    ejemplos: [] as any[],
  };

  try {
    // ---------- A) Reauditar señales existentes ----------
    if (solo !== "recuperar") {
      const { data: senales, error } = await sb.from("wa_consent_signals")
        .select("id, owner_id, hs_call_id, cita_textual, telefono, veredicto, review_status, origen, fuente")
        .in("veredicto", ["autorizado", "dudoso"])
        .limit(limit);
      if (error) throw error;

      for (const s of senales ?? []) {
        const { data: call } = await sb.from("hubspot_calls")
          .select("hs_call_transcription").eq("hs_id", s.hs_call_id).maybeSingle();
        const { data: owner } = await sb.from("owners")
          .select("telefono, email").eq("id", s.owner_id).maybeSingle();
        const transcripcion = (call as any)?.hs_call_transcription ?? null;
        const esDemo = String((owner as any)?.email ?? "").toLowerCase().endsWith("@example.com");

        // Sin transcripción no hay forma de comprobar la cita: no se aprueba.
        const val = validarConsentimiento({
          veredicto: "autorizado",
          cita: s.cita_textual,
          transcripcion,
          telefonoLlamada: s.telefono,
          telefonoFicha: (owner as any)?.telefono ?? null,
        });
        const motivos = [...val.motivos];
        if (!transcripcion) motivos.push("sin_transcripcion_para_comprobar");
        if (esDemo) motivos.push("registro_de_demo");
        const limpio = motivos.length === 0;

        resumen.reauditadas++;
        if (dry) continue;
        await sb.from("wa_consent_signals").update({
          veredicto: limpio ? "autorizado" : "dudoso",
          review_status: limpio ? null : "pendiente_revision",
          review_reason: limpio ? null : motivos.join(", "),
          review_updated_at: new Date().toISOString(),
          veto_motivos: val.vetos,
          validacion: { ...val, motivos } as any,
          confianza: limpio ? 0.95 : 0.4,
        }).eq("id", s.id);
        if (limpio) {
          resumen.reaprobadas++;
          await sb.from("owners").update({ consentimiento: true }).eq("id", s.owner_id);
        } else {
          resumen.degradadas++;
        }
      }
    }

    // ---------- B) Recuperar permisos reales no registrados ----------
    if (solo !== "reauditar") {
      const { data: calls, error: cErr } = await sb.from("hubspot_calls")
        .select("hs_id, hs_timestamp, hs_call_transcription, hs_call_to_number, hs_call_from_number, associated_contact_ids")
        .not("hs_call_transcription", "is", null)
        .ilike("hs_call_transcription", "%whats%")
        .order("hs_timestamp", { ascending: false })
        .limit(limit);
      if (cErr) throw cErr;

      for (const c of calls ?? []) {
        resumen.llamadas_revisadas++;
        const { data: yaHay } = await sb.from("wa_consent_signals")
          .select("id").eq("hs_call_id", c.hs_id).limit(1);
        if (yaHay?.length) continue;

        const transcripcion = String(c.hs_call_transcription ?? "");
        const veto = detectarVeto(transcripcion);
        if (veto.vetado) { resumen.vetadas++; continue; }

        const cita = extraerCitaConsentimiento(transcripcion);
        if (!cita) continue;

        const contactIds: string[] = (c.associated_contact_ids ?? []) as string[];
        if (!contactIds.length) continue;
        const { data: ext } = await sb.from("external_ids")
          .select("entity_id").eq("entity_type", "owner").eq("provider", "hubspot")
          .in("provider_id", contactIds).limit(1);
        const ownerId = ext?.[0]?.entity_id;
        if (!ownerId) continue;

        const telefono = String(c.hs_call_to_number || c.hs_call_from_number || "").trim() || null;
        const { data: owner } = await sb.from("owners")
          .select("telefono").eq("id", ownerId).maybeSingle();
        const val = validarConsentimiento({
          veredicto: "autorizado",
          cita,
          transcripcion,
          telefonoLlamada: telefono,
          telefonoFicha: (owner as any)?.telefono ?? null,
        });

        resumen.ejemplos.length < 15 && resumen.ejemplos.push({
          hs_call_id: c.hs_id, owner_id: ownerId, cita, apto: val.apto_para_escritura, motivos: val.motivos,
        });
        if (dry) { if (val.apto_para_escritura) resumen.recuperadas++; continue; }

        await sb.from("wa_consent_signals").insert({
          owner_id: ownerId,
          hs_call_id: c.hs_id,
          veredicto: val.apto_para_escritura ? "autorizado" : "dudoso",
          cita_textual: cita,
          telefono,
          confianza: val.apto_para_escritura ? 0.95 : 0.4,
          fecha_llamada: c.hs_timestamp ?? null,
          detectado_at: new Date().toISOString(),
          fuente: "reauditoria_transcripcion",
          origen: "sistema",
          escrito_en_hubspot: false,
          validacion: val as any,
          veto_motivos: val.vetos,
          review_status: val.apto_para_escritura ? null : "pendiente_revision",
          review_reason: val.apto_para_escritura ? null : val.motivos.join(", "),
        });
        if (val.apto_para_escritura) {
          resumen.recuperadas++;
          await sb.from("owners").update({ consentimiento: true }).eq("id", ownerId);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, dry_run: dry, elapsed_ms: Date.now() - t0, ...resumen }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message ?? String(e), ...resumen }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
