// finalize_call_session
// Cierra una call_session: localiza la última llamada del propietario
// (hubspot_calls vía external_ids, fallback a public.calls con transcripción),
// invoca agent_voss_coach mode=post, persiste voss_post + checklist
// auto-rellenado con citas, puntuacion, hubspot_call_id, call_id, cerrada_at,
// estado='finalizada'. Inserta/actualiza una fila en public.calls para que
// learn_from_calls la procese.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { sendEmail, escapeHtml } from "../_shared/mailer.ts";
import { emailForHsOwner, nombreForHsOwner, sanitizeRecipients } from "../_shared/comerciales.ts";

const CHECK_KEYS = ["tipologia", "motor", "info_edificio", "canal_abierto"] as const;
const CHECK_LABELS: Record<string, string> = {
  tipologia: "Tipología del propietario (T1–T10 / buyer persona)",
  motor: "Qué le mueve (motor real: dinero, paz, herederos, miedo, control)",
  info_edificio: "Info edificio / copropietarios / alquileres",
  canal_abierto: "Canal abierto (opt-in WhatsApp / mail / influenciador)",
};
// agent_voss_coach devuelve checklist con sufijo _capturada
const POST_KEY_MAP: Record<string, string> = {
  tipologia: "tipologia_capturada",
  motor: "motor_capturado",
  info_edificio: "info_edificio_capturada",
  canal_abierto: "canal_abierto",
};

// Programación de reintentos para el auto-análisis cuando HubSpot todavía no
// ha subido la transcripción / grabación. Minutos desde el cierre de la
// llamada: 3, 5, 10 (3 intentos). Después se deja en "en_espera_transcripcion".
const RETRY_MINUTES = [3, 5, 10] as const;
const MAX_RETRIES = RETRY_MINUTES.length;

function nextRetryOffsetMin(retriesLeft: number): number | null {
  // retriesLeft: cuántos intentos quedan ANTES de este intento.
  // Ej. inicial (nunca lanzado auto-retry) → intent index = 0 → 3 min
  const idx = MAX_RETRIES - retriesLeft;
  if (idx < 0 || idx >= RETRY_MINUTES.length) return null;
  return RETRY_MINUTES[idx];
}

function defaultChecklist() {
  return CHECK_KEYS.map((k) => ({
    k, label: CHECK_LABELS[k], done: false, evidencia: null as string | null,
  }));
}

async function findHubspotCall(sb: any, ownerId: string, sinceIso: string | null) {
  const { data: ext } = await sb.from("external_ids")
    .select("provider_id")
    .eq("entity_type", "owner").eq("provider", "hubspot")
    .eq("entity_id", ownerId).maybeSingle();
  const hsContactId = ext?.provider_id;
  if (!hsContactId) return null;
  let q = sb.from("hubspot_calls")
    .select("id, hs_id, hs_timestamp, hs_call_body, hs_call_transcription, hs_call_recording_url, hs_call_duration, associated_contact_ids")
    .contains("associated_contact_ids", [hsContactId])
    .order("hs_timestamp", { ascending: false }).limit(1);
  if (sinceIso) q = q.gte("hs_timestamp", sinceIso);
  const { data } = await q.maybeSingle();
  return data ?? null;
}

async function findFallbackCall(sb: any, ownerId: string, sinceIso: string | null) {
  let q = sb.from("calls")
    .select("id, fecha, transcripcion, resumen, outcome, notas_post_llamada, duracion_seg")
    .eq("owner_id", ownerId)
    .order("fecha", { ascending: false }).limit(1);
  if (sinceIso) q = q.gte("fecha", sinceIso);
  const { data } = await q.maybeSingle();
  return data ?? null;
}

// Devuelve el estado acumulativo de KPIs del propietario (owner_kpis_state).
// Se usa para marcar en el checklist final "previamente_conseguido" y NO
// penalizar el score si un KPI ya se había conseguido en llamadas anteriores.
async function fetchOwnerKpiState(sb: any, ownerId: string, currentHsCallId: string | null) {
  const { data, error } = await sb.from("owner_kpis_state")
    .select("k, first_done_at, first_hubspot_call_id, times_done")
    .eq("owner_id", ownerId);
  if (error) return {};
  const map: Record<string, { first_done_at: string; first_hubspot_call_id: string | null; is_prior: boolean }> = {};
  for (const row of data ?? []) {
    const priorHsId = row.first_hubspot_call_id;
    // Es "previo" si la primera vez no fue en la llamada que estamos cerrando.
    const isPrior = !currentHsCallId || String(priorHsId ?? "") !== String(currentHsCallId);
    map[row.k] = {
      first_done_at: row.first_done_at,
      first_hubspot_call_id: priorHsId,
      is_prior: isPrior,
    };
  }
  return map;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const { session_id, ignore_since } = body;
    if (!session_id) throw new Error("session_id requerido");

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: session, error: sErr } = await sb.from("call_sessions")
      .select("*").eq("id", session_id).maybeSingle();
    if (sErr || !session) throw new Error(sErr?.message || "sesión no encontrada");
    if (session.estado === "finalizada") {
      return new Response(JSON.stringify({ ok: true, already_finalized: true, session }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const ownerId = session.owner_id;
    const buildingId = session.building_id;
    if (!ownerId) throw new Error("session sin owner_id");

    // Contador de reintentos: si la sesión aún no arrancó la cola de retries,
    // arrancarla con MAX_RETRIES.
    const retriesLeft = typeof session.retries_left === "number" ? session.retries_left : MAX_RETRIES;

    const sinceIso = ignore_since ? null : (session.iniciada_at || session.created_at || null);

    // 1) Localiza la llamada
    const hsCall = await findHubspotCall(sb, ownerId, sinceIso);
    const fbCall = !hsCall ? await findFallbackCall(sb, ownerId, sinceIso) : null;

    let transcript: string | null = null;
    let callId: string | null = session.call_id ?? null;
    let hubspotCallId: string | null = null;
    let foundSource: string = "none";

    if (hsCall) {
      hubspotCallId = hsCall.hs_id;
      transcript = hsCall.hs_call_transcription || hsCall.hs_call_body || null;
      foundSource = "hubspot_calls";
      // Si no hay transcripción pero SÍ hay grabación, transcribimos en el momento.
      const shortTranscript = !transcript || String(transcript).trim().length < 20;
      if (shortTranscript && hsCall.hs_call_recording_url && (hsCall.hs_call_duration ?? 0) >= 45000) {
        try {
          const tRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/transcribe_calls`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({ call_id: hsCall.hs_id }),
          });
          if (tRes.ok) {
            const tj = await tRes.json().catch(() => ({}));
            if (tj?.ok && tj?.text_preview) {
              // Releer la fila para tener el texto completo
              const { data: reread } = await sb.from("hubspot_calls")
                .select("hs_call_transcription").eq("hs_id", hsCall.hs_id).maybeSingle();
              transcript = reread?.hs_call_transcription || transcript;
            }
          }
        } catch (e) { console.warn("[finalize_call_session] transcribe inline fail", (e as Error).message); }
      }
      // Espejo en public.calls si no existe
      if (!callId) {
        const { data: ins } = await sb.from("calls").insert({
          owner_id: ownerId,
          fecha: hsCall.hs_timestamp ?? new Date().toISOString(),
          direccion: "saliente",
          duracion_seg: hsCall.hs_call_duration == null ? null : Math.round(Number(hsCall.hs_call_duration) / 1000),
          transcripcion: transcript,
          transcripcion_source: "hubspot",
          metadatos: { hubspot_call_id: hsCall.hs_id },
        }).select("id").maybeSingle();
        callId = ins?.id ?? null;
      }
    } else if (fbCall) {
      callId = fbCall.id;
      transcript = fbCall.transcripcion || fbCall.resumen || fbCall.notas_post_llamada || null;
      foundSource = "calls";
    }

    if (!transcript || transcript.trim().length < 20) {
      // Sin transcripción aprovechable: programar reintento a 3/5/10 min si
      // quedan intentos. Si no, marcar en_espera_transcripcion definitivo.
      const offset = nextRetryOffsetMin(retriesLeft);
      if (offset !== null) {
        const next = new Date(Date.now() + offset * 60_000).toISOString();
        await sb.from("call_sessions").update({
          estado: "en_espera_transcripcion",
          next_retry_at: next,
          retries_left: retriesLeft - 1,
          notas: (session.notas || "") + `\n[finalize_call_session] sin transcripción · reintento en ${offset}m (${MAX_RETRIES - retriesLeft + 1}/${MAX_RETRIES})`,
        }).eq("id", session_id);
        return new Response(JSON.stringify({
          ok: false, reason: "sin_transcripcion_retry_scheduled",
          next_retry_at: next, retries_left: retriesLeft - 1,
          source: foundSource, hubspot_call_id: hubspotCallId,
        }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      await sb.from("call_sessions").update({
        estado: "en_espera_transcripcion",
        next_retry_at: null,
        retries_left: 0,
        notas: (session.notas || "") + "\n[finalize_call_session] sin transcripción aprovechable tras 3 intentos",
      }).eq("id", session_id);
      return new Response(JSON.stringify({
        ok: false, reason: "sin_transcripcion", source: foundSource, hubspot_call_id: hubspotCallId,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2) Llamar a agent_voss_coach mode=post
    const coachRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/agent_voss_coach`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        mode: "post",
        owner_id: ownerId,
        building_id: buildingId,
        call_transcript: transcript,
        call_duration_seg: hsCall?.hs_call_duration == null
          ? (fbCall?.duracion_seg ?? null)
          : Math.round(Number(hsCall.hs_call_duration) / 1000),
        call_summary: hsCall?.hs_call_summary ?? fbCall?.resumen ?? null,
      }),
    });
    if (!coachRes.ok) throw new Error(`agent_voss_coach ${coachRes.status}: ${await coachRes.text().catch(()=> "")}`);
    const coachJson = await coachRes.json();
    const voss = coachJson?.voss ?? {};
    const postChecks = voss?.checklist ?? {};
    const puntuacion = Number(voss?.puntuacion?.score_0_100 ?? voss?.puntuacion ?? 0) || 0;

    // 3) Mapear checklist · KPIs acumulativos (Tanda B · punto 2)
    // Un KPI marcado ya conseguido en una llamada anterior queda done=true y se
    // marca previamente_conseguido con fecha y hs_call_id. NO se penaliza el
    // score si el post-mode devuelve ok:false para ese KPI concreto.
    const kpiState = await fetchOwnerKpiState(sb, ownerId, hubspotCallId);
    const prevChecklist: any[] = Array.isArray(session.checklist) && session.checklist.length
      ? session.checklist : defaultChecklist();
    const indexedPrev: Record<string, any> = {};
    for (const c of prevChecklist) indexedPrev[c.k] = c;
    const newChecklist = CHECK_KEYS.map((k) => {
      const postKey = POST_KEY_MAP[k];
      const evalEntry = postChecks[postKey] ?? {};
      const prev = indexedPrev[k] ?? { k, label: CHECK_LABELS[k], done: false };
      const ok = Boolean(evalEntry?.ok);
      const prior = kpiState[k];
      const previamente_conseguido = prior?.is_prior && !ok
        ? { fecha: prior.first_done_at, hubspot_call_id: prior.first_hubspot_call_id }
        : null;
      return {
        k, label: CHECK_LABELS[k],
        done: ok || Boolean(prev.done) || Boolean(previamente_conseguido),
        auto_done: ok,
        previamente_conseguido,
        evidencia: evalEntry?.evidencia ?? prev?.evidencia ?? null,
      };
    });

    // 4) NO escribimos resumen máquina en `notas`. El análisis vive en `voss_post`
    //    (fuente única para todas las vistas). `notas` queda para notas humanas.

    // 5) Si tenemos call_id pero faltan campos clave, actualizar
    if (callId && transcript) {
      // Bloque A · KPIs fantasma del doc Afflux: escribimos en calls.metadatos
      // los flags que la vista v_kpis_comercial_semana cuenta pero nadie
      // poblaba (whatsapp_enviado, pixel_enviado, reunion_cerrada).
      const objetivo = String(session.objetivo ?? "").toLowerCase();
      const proxAccion = String(voss?.proxima_accion ?? "").toLowerCase();
      const vossOutcome = String(voss?.outcome ?? "").toLowerCase();
      const sessionResultado = String(session.resultado ?? "").toLowerCase();
      // Reunión cerrada = el objetivo era reunión y o bien voss lo confirma,
      // o bien el comercial marcó "interesado", o el outcome/proxima_accion
      // menciona reunión / cita / agendar.
      const mentionsMeeting =
        /(reuni[oó]n|cita|agenda)/.test(proxAccion) ||
        /(reuni[oó]n|cita|agenda)/.test(vossOutcome);
      const reunionCerrada =
        (objetivo === "reunion" && (sessionResultado === "interesado" || mentionsMeeting)) ||
        vossOutcome === "reunion_agendada";

      const kpiFlags: Record<string, unknown> = {
        whatsapp_enviado: objetivo === "whatsapp" ? true : undefined,
        pixel_enviado: objetivo === "pixel" ? true : undefined,
        reunion_cerrada: reunionCerrada ? true : undefined,
        objetivo,
      };
      // Mezclar con metadatos existentes preservando flags previos.
      const { data: prevCall } = await sb.from("calls")
        .select("metadatos").eq("id", callId).maybeSingle();
      const prevMeta = (prevCall?.metadatos ?? {}) as Record<string, unknown>;
      const mergedMeta: Record<string, unknown> = { ...prevMeta };
      for (const [k, v] of Object.entries(kpiFlags)) {
        if (v !== undefined && v !== null) mergedMeta[k] = v;
      }

      await sb.from("calls").update({
        transcripcion: transcript,
        outcome: voss?.outcome ?? undefined,
        resumen: voss?.puntuacion?.justificacion ?? undefined,
        siguiente_accion: voss?.proxima_accion ?? undefined,
        tecnica_score: puntuacion,
        metadatos: mergedMeta,
      }).eq("id", callId);
    }

    // 6) Persistir en session
    await sb.from("call_sessions").update({
      voss_post: voss,
      checklist: newChecklist,
      puntuacion,
      hubspot_call_id: hubspotCallId,
      call_id: callId,
      paso: 3,
      estado: "finalizada",
      next_retry_at: null,
      retries_left: 0,
      finalizada_at: new Date().toISOString(),
      cerrada_at: new Date().toISOString(),
      // Fuente única de análisis = voss_post. Limpiamos resúmenes máquina
      // antiguos que se guardaron aquí en versiones previas para que la
      // sección "Notas" no muestre información desactualizada al regenerar.
      notas: /^Score:\s*\d/i.test(String(session.notas ?? "")) ? null : session.notas,
    }).eq("id", session_id);

    // Asegura que el expediente conserve los KPIs objetivo. Si en la sesión
    // no se registró (sesiones antiguas), lo derivamos del propio checklist
    // final para que la ficha del propietario los pueda mostrar.
    if (!session.kpis_objetivo) {
      await sb.from("call_sessions").update({
        kpis_objetivo: {
          claves: newChecklist.map((c) => c.k),
          labels: newChecklist.map((c) => c.label),
        },
      }).eq("id", session_id).is("kpis_objetivo", null);
    }

    // 7) Alimentar el playbook (fire & forget)
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/learn_from_calls`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ since_days: 1 }),
    }).catch(() => {});

    // Bloque B · push a HubSpot (nota engagement + propiedades del contacto + lead_status)
    // Fire & forget: si falta contacto HubSpot o falla, no rompe el cierre de sesión.
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/hubspot_sync_call_kpis`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ session_id }),
    }).catch(() => {});

    // 8) Email "Tu llamada ya está analizada" al comercial dueño (Tanda C · 6)
    // Mapa canónico por hs_owner_id (Jesús=76826178, David=76826175). Si no
    // se puede determinar, fallback a Jesús. NUNCA a agustin.cifuentes@outlook.es.
    try {
      // Determinar hs_owner_id de la llamada: primero de hubspot_calls, luego
      // de calls.comercial_hs_id.
      let hsOwnerId: string | null = null;
      if (hubspotCallId) {
        const { data: hc } = await sb.from("hubspot_calls")
          .select("hs_owner_id").eq("hs_id", hubspotCallId).maybeSingle();
        hsOwnerId = (hc as any)?.hs_owner_id ?? null;
      }
      if (!hsOwnerId && callId) {
        const { data: c } = await sb.from("calls")
          .select("comercial_hs_id").eq("id", callId).maybeSingle();
        hsOwnerId = (c as any)?.comercial_hs_id ?? null;
      }
      const to = emailForHsOwner(hsOwnerId);
      const nombreComercial = nombreForHsOwner(hsOwnerId);
      // Nombre del propietario para el asunto
      const { data: ownerRow } = await sb.from("owners")
        .select("nombre").eq("id", ownerId).maybeSingle();
      const ownerName = (ownerRow as any)?.nombre || "propietario";
      const appUrl = Deno.env.get("PUBLIC_APP_URL") || "https://www.affluxosv2.world";
      const expLink = hubspotCallId
        ? `${appUrl}/comercial/llamada/${encodeURIComponent(hubspotCallId)}`
        : `${appUrl}/comercial/edificios`;
      const scoreTxt = `${Math.round(puntuacion)}/100`;
      const proxAccion = voss?.proxima_accion ? String(voss.proxima_accion).slice(0, 400) : "";
      const html = `
        <div style="font-family:Inter,Arial,sans-serif;color:#111">
          <p>Hola ${escapeHtml(nombreComercial)},</p>
          <p>Tu llamada con <b>${escapeHtml(ownerName)}</b> ya está analizada.</p>
          <p><b>Score:</b> ${scoreTxt}</p>
          ${proxAccion ? `<p><b>Próxima acción:</b> ${escapeHtml(proxAccion)}</p>` : ""}
          <p><a href="${expLink}" style="background:#c9a24a;color:#111;padding:8px 14px;border-radius:4px;text-decoration:none;font-weight:600">Ver expediente</a></p>
          <p style="color:#666;font-size:12px">Afflux OS · notificación automática</p>
        </div>`;
      const finalTo = sanitizeRecipients([to]);
      if (finalTo.length) {
        await sendEmail({
          to: finalTo,
          subject: `Llamada analizada — ${ownerName} — ${scoreTxt}`,
          html,
          text: `Llamada con ${ownerName} analizada. Score ${scoreTxt}. Expediente: ${expLink}`,
        });
      }
    } catch (e) {
      console.warn("[finalize_call_session] email comercial fail", (e as Error).message);
    }

    return new Response(JSON.stringify({
      ok: true, source: foundSource, hubspot_call_id: hubspotCallId, call_id: callId,
      puntuacion, checks: newChecklist,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("finalize_call_session", (e as Error).message);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});