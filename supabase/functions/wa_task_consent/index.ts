// wa_task_consent — registra el consentimiento telefónico del propietario
// para recibir WhatsApp, con trazabilidad (propietario, tarea, usuario, fecha).
//
// REGLA LEGAL: una marca manual NUNCA inventa una cita del propietario.
// Queda identificada como declaración del comercial (origen='comercial'),
// con confianza limitada y pendiente de revisión salvo que se aporte la
// frase literal que dijo el propietario. Si la llamada contiene un veto
// (lista Robinson, protección de datos, baja, queja por el origen del
// dato), se rechaza y se abre incidencia.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json, resolverContexto } from '../_shared/tareaWhatsapp.ts';
import { citaExisteLiteral, detectarVeto, esAceptacionExplicita } from '../_shared/waConsent.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '').trim();
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const authed = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });

    const body = await req.json().catch(() => ({}));
    const res = await resolverContexto(admin, authed, token, body?.task_id, body?.owner_id);
    if ('error' in res) return res.error;
    const { ctx } = res;

    const citaAportada = String(body?.cita_textual ?? '').trim();
    const ahora = new Date().toISOString();

    // Última transcripción del propietario, para veto y para comprobar la cita.
    const { data: llamadas } = await admin
      .from('v_owner_calls_enriched')
      .select('hs_call_transcription')
      .eq('owner_id', ctx.owner.id)
      .order('hs_timestamp', { ascending: false })
      .limit(3);
    const transcripciones = (llamadas ?? [])
      .map((l: any) => String(l?.hs_call_transcription ?? ''))
      .filter(Boolean);
    const veto = detectarVeto(transcripciones.join('\n'));

    if (veto.vetado) {
      await admin.from('wa_consent_incidencias').insert({
        owner_id: ctx.owner.id,
        tipo: 'veto_privacidad',
        motivos: veto.motivos,
        detalle: 'Marca manual bloqueada: la llamada contiene una objeción de privacidad.',
      });
      return json(409, {
        ok: false,
        error: 'veto_privacidad',
        motivos: veto.motivos,
        mensaje: 'No se puede registrar el consentimiento: en la llamada consta una objeción de privacidad. Se ha abierto una incidencia para revisión.',
      });
    }

    const citaValida = citaAportada !== '' &&
      esAceptacionExplicita(citaAportada) &&
      (transcripciones.length === 0 ||
        transcripciones.some((t) => citaExisteLiteral(t, citaAportada)));

    const { data: fila, error } = await admin
      .from('wa_consent_signals')
      .insert({
        owner_id: ctx.owner.id,
        // Identificador sintético: el consentimiento nace en la tarjeta, no en una llamada de HubSpot.
        hs_call_id: `tarjeta:${ctx.tarea.id}:${ahora}`,
        veredicto: 'autorizado',
        // Nunca una cita de plantilla: o es la frase real del propietario, o no hay cita.
        cita_textual: citaValida ? citaAportada : null,
        telefono: ctx.owner.telefono ?? null,
        confianza: citaValida ? 0.9 : 0.5,
        fecha_llamada: ahora,
        detectado_at: ahora,
        task_id: ctx.tarea.id,
        registrado_por: ctx.userId,
        fuente: 'tarjeta_primera_llamada',
        origen: 'comercial',
        review_status: citaValida ? null : 'pendiente_revision',
        review_reason: citaValida
          ? null
          : 'declarado por el comercial sin cita literal del propietario',
        review_updated_at: ahora,
        validacion: { cita_aportada: citaAportada || null, cita_valida: citaValida, vetos: veto.motivos },
      })
      .select('id,owner_id,veredicto,task_id,registrado_por,fuente,origen,review_status,detectado_at')
      .single();
    if (error) throw error;

    // owners.consentimiento sólo si hay evidencia real del propietario.
    if (citaValida) {
      await admin.from('owners').update({ consentimiento: true }).eq('id', ctx.owner.id);
    }

    return json(200, {
      ok: true,
      consentimiento: fila,
      requiere_revision: !citaValida,
      mensaje: citaValida
        ? 'Consentimiento registrado con la frase literal del propietario.'
        : 'Registrado como declaración del comercial: queda pendiente de revisión y no se escribe en el CRM.',
    });
  } catch (e) {
    return json(500, { ok: false, error: (e as Error)?.message ?? String(e) });
  }
});
