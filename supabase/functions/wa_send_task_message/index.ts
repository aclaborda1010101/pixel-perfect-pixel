// wa_send_task_message — envía el WhatsApp de la tarjeta de primera llamada
// reutilizando la infraestructura existente (Evolution + tablas wa_*).
// Rechaza SIEMPRE si el propietario no tiene consentimiento registrado.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { evoFetch, EVOLUTION_INSTANCE } from '../_shared/evolution.ts';
import { corsHeaders, json, resolverContexto } from '../_shared/tareaWhatsapp.ts';
import {
  PLANTILLA_T23_POR_DEFECTO,
  decidirDestino,
  renderPlantilla,
  resolverTextoFinal,
  tieneConsentimiento,
} from '../_shared/whatsappTarjeta.ts';

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

    // 1. Consentimiento obligatorio (también si se llama a la función directamente).
    const { data: senales } = await admin
      .from('wa_consent_signals')
      .select('owner_id,veredicto')
      .eq('owner_id', ctx.owner.id);
    if (!tieneConsentimiento(senales ?? [], ctx.owner.id)) {
      return json(403, { ok: false, error: 'sin_consentimiento' });
    }

    // 2. Ajustes: plantilla y modo prueba.
    const { data: ajustes } = await admin
      .from('app_settings')
      .select('key,value')
      .in('key', ['plantilla_whatsapp_t23', 'wa_modo_prueba', 'wa_numero_prueba']);
    const conf = new Map((ajustes ?? []).map((r: any) => [r.key, r.value]));
    const plantilla = String(conf.get('plantilla_whatsapp_t23')?.texto ?? PLANTILLA_T23_POR_DEFECTO);
    const modoPruebaRaw = conf.get('wa_modo_prueba')?.activo;
    const modoPrueba = modoPruebaRaw === undefined ? true : !!modoPruebaRaw;
    const numeroPrueba = String(conf.get('wa_numero_prueba')?.numero ?? '');

    // 3. Nombre del comercial que envía.
    const { data: perfil } = await admin
      .from('profiles')
      .select('full_name,email')
      .eq('id', ctx.userId)
      .maybeSingle();
    const comercial = String(perfil?.full_name ?? perfil?.email ?? '').split('@')[0];

    const textoPlantilla = renderPlantilla(plantilla, {
      nombre: ctx.owner.nombre_display ?? ctx.owner.nombre,
      comercial,
      direccion: ctx.edificio?.direccion ?? null,
    });
    const { texto, editado } = resolverTextoFinal(textoPlantilla, body?.texto);

    const destino = decidirDestino({
      modoPrueba,
      numeroPrueba,
      telefonoPropietario: ctx.owner.telefono,
    });
    if (destino.modo === 'simulado' && destino.motivo === 'propietario_sin_telefono') {
      return json(400, { ok: false, error: 'propietario_sin_telefono' });
    }

    // 3 bis. Vista previa: se devuelve el mensaje exacto sin enviar ni registrar nada.
    if (String(body?.accion ?? '') === 'preview') {
      return json(200, {
        ok: true,
        preview: true,
        texto: textoPlantilla,
        modo: destino.modo,
        es_prueba: destino.modo !== 'real',
        telefono_destino: destino.telefono,
        telefono_propietario: ctx.owner.telefono ?? null,
        modo_prueba: modoPrueba,
        numero_prueba: numeroPrueba || null,
        motivo: destino.motivo ?? null,
      });
    }

    // 4. Envío real sólo cuando hay destino; en simulado no sale nada.
    let evo: any = null;
    if (destino.telefono) {
      evo = await evoFetch(`/message/sendText/${EVOLUTION_INSTANCE}`, {
        method: 'POST',
        body: JSON.stringify({ number: destino.telefono, text: texto }),
      });
    }

    // 5. Registro en el mismo sitio que el resto de mensajes salientes.
    const telefonoRegistro = destino.telefono ?? String(ctx.owner.telefono ?? '').replace(/[^0-9]/g, '');
    let conversationId: string | null = null;
    let contactId: string | null = null;
    if (telefonoRegistro) {
      const { data: contacto } = await admin
        .from('wa_contacts')
        .upsert({ phone: telefonoRegistro }, { onConflict: 'phone' })
        .select('id')
        .single();
      contactId = contacto?.id ?? null;
      if (contactId) {
        const { data: existente } = await admin
          .from('wa_conversations')
          .select('id')
          .eq('contact_id', contactId)
          .order('last_message_at', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();
        conversationId = existente?.id ?? null;
        if (!conversationId) {
          const { data: nueva } = await admin
            .from('wa_conversations')
            .insert({ contact_id: contactId, status: 'open' })
            .select('id')
            .single();
          conversationId = nueva?.id ?? null;
        }
      }
    }

    const { data: mensaje } = await admin
      .from('wa_messages')
      .insert({
        conversation_id: conversationId,
        contact_id: contactId,
        direction: 'out',
        type: 'text',
        content: texto,
        evolution_message_id: evo?.key?.id ?? null,
        ai_generated: false,
        sender_type: 'human_agent',
        agent_user_id: ctx.userId,
        status: destino.modo === 'simulado' ? 'simulado' : 'sent',
        metadata: {
          modo_envio: destino.modo,
          es_prueba: destino.modo !== 'real',
          task_id: ctx.tarea.id,
          owner_id: ctx.owner.id,
          building_id: ctx.tarea.building_id,
          plantilla: 'plantilla_whatsapp_t23',
          editado_a_mano: editado,
          texto_plantilla: editado ? textoPlantilla : null,
          telefono_destino: destino.telefono,
          telefono_propietario: ctx.owner.telefono ?? null,
          motivo: destino.motivo ?? null,
          evo,
        },
      })
      .select('id')
      .single();

    if (conversationId) {
      await admin
        .from('wa_conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', conversationId);
    }

    return json(200, {
      ok: true,
      modo: destino.modo,
      es_prueba: destino.modo !== 'real',
      telefono_destino: destino.telefono,
      texto,
      editado_a_mano: editado,
      message_id: mensaje?.id ?? null,
    });
  } catch (e) {
    return json(500, { ok: false, error: (e as Error)?.message ?? String(e) });
  }
});
