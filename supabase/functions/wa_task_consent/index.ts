// wa_task_consent — registra el consentimiento telefónico del propietario
// para recibir WhatsApp, con trazabilidad (propietario, tarea, usuario, fecha).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json, resolverContexto } from '../_shared/tareaWhatsapp.ts';

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

    const ahora = new Date().toISOString();
    const { data: fila, error } = await admin
      .from('wa_consent_signals')
      .insert({
        owner_id: ctx.owner.id,
        // Identificador sintético: el consentimiento nace en la tarjeta, no en una llamada de HubSpot.
        hs_call_id: `tarjeta:${ctx.tarea.id}:${ahora}`,
        veredicto: 'autorizado',
        cita_textual: 'El propietario ha autorizado por teléfono el envío de WhatsApp.',
        telefono: ctx.owner.telefono ?? null,
        confianza: 1,
        fecha_llamada: ahora,
        detectado_at: ahora,
        task_id: ctx.tarea.id,
        registrado_por: ctx.userId,
        fuente: 'tarjeta_primera_llamada',
      })
      .select('id,owner_id,veredicto,task_id,registrado_por,fuente,detectado_at')
      .single();
    if (error) throw error;

    await admin.from('owners').update({ consentimiento: true }).eq('id', ctx.owner.id);

    return json(200, { ok: true, consentimiento: fila });
  } catch (e) {
    return json(500, { ok: false, error: (e as Error)?.message ?? String(e) });
  }
});
