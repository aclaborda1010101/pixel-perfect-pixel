// cotejo_hubspot_masivo — recorre los edificios y los coteja campo a campo
// contra HubSpot, por lotes pequeños y guardando el avance.
// SOLO LECTURA sobre HubSpot.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { corsHeaders, hubspotFetch, DEAL_PROPERTIES } from '../_shared/hubspot.ts';
import { sincronizarEdificioDesdeHubspot } from '../_shared/hubspotBuildingSync.ts';
import { camposDelNegocio, cotejarInmueble, type Incidencia } from '../_shared/cotejoEdificio.ts';

const LOTE_MAX = 25;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Sólo se invoca desde el panel de administración o desde el proceso programado.
  const secret = req.headers.get('x-cotejo-key') ?? '';
  const esperado = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  let autorizado = secret === esperado || authHeader === esperado;
  if (!autorizado && secret) {
    const { data: tok } = await admin.from('internal_tokens')
      .select('token').eq('name', 'cotejo_run').maybeSingle();
    const guardado = tok?.token as string | undefined;
    autorizado = !!guardado && secret === guardado;
  }
  if (!autorizado && authHeader) {
    const { data: userData } = await admin.auth.getUser(authHeader);
    if (userData?.user) {
      const { data: roles } = await admin.from('user_roles')
        .select('role').eq('user_id', userData.user.id).eq('role', 'admin');
      autorizado = !!roles && roles.length > 0;
    }
  }
  if (!autorizado) return json({ ok: false, error: 'No autorizado.' }, 403);


  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* sin cuerpo */ }
  const lote = Math.min(LOTE_MAX, Math.max(1, Number(body.lote ?? 10)));
  const rehacer = body.rehacer === true;
  let runId = typeof body.run_id === 'string' ? body.run_id : '';

  // --- Run: se reutiliza el que esté en curso para no perder el avance ---
  if (!runId) {
    const { data: enCurso } = await admin.from('cotejo_hubspot_runs')
      .select('id').eq('estado', 'en_curso')
      .order('started_at', { ascending: false }).limit(1).maybeSingle();
    if (enCurso?.id) runId = enCurso.id;
  }
  if (!runId) {
    const { count } = await admin.from('buildings')
      .select('id', { count: 'exact', head: true });
    const { data: nuevo } = await admin.from('cotejo_hubspot_runs')
      .insert({ total_objetivo: Number(count ?? 0) }).select('id').single();
    runId = nuevo!.id;
  }

  // --- Selección del lote: primero los nunca cotejados, luego los más antiguos ---
  let q = admin.from('buildings')
    .select('id, direccion, refcatastral, metros_viviendas, metros_comercio, metros_oficina, num_viviendas, pct_terciario, pct_residencial, distrito, barrio, hs_deal_id, hs_props_synced_at')
    .order('hs_props_synced_at', { ascending: true, nullsFirst: true })
    .limit(lote);
  if (!rehacer) q = q.is('hs_props_synced_at', null);
  const { data: edificios, error: selErr } = await q;
  if (selErr) return json({ ok: false, error: selErr.message }, 500);

  if (!edificios || edificios.length === 0) {
    await admin.from('cotejo_hubspot_runs')
      .update({ estado: 'terminado', finished_at: new Date().toISOString() })
      .eq('id', runId);
    return json({ ok: true, run_id: runId, terminado: true, procesados_en_esta_pasada: 0 });
  }

  const incidencias: Incidencia[] = [];
  let ok = 0, fallidos = 0, sinNegocio = 0;
  const errores: Array<{ building_id: string; error: string }> = [];

  for (const b of edificios) {
    try {
      if (!b.hs_deal_id) {
        sinNegocio++;
        incidencias.push({
          building_id: b.id,
          tipo: 'sin_negocio_hubspot',
          titulo: 'El edificio no tiene negocio asociado en HubSpot',
          detalle: { direccion: b.direccion },
          resolucion: 'revision_humana',
        });
        // Se marca igualmente como cotejado: no hay nada más que traer.
        await admin.from('buildings')
          .update({ hs_props_synced_at: new Date().toISOString() }).eq('id', b.id);
        ok++;
        continue;
      }

      // 1) Campos del inmueble (lectura del negocio)
      const deal = await hubspotFetch(
        `/crm/v3/objects/deals/${b.hs_deal_id}?properties=${DEAL_PROPERTIES.join(',')}`,
      );
      const props = (deal?.properties ?? {}) as Record<string, unknown>;
      const hsCampos = camposDelNegocio(props);
      const { parche, incidencias: incs } = cotejarInmueble(b.id, b as Record<string, unknown>, hsCampos);
      incidencias.push(...incs);

      if (Object.keys(parche).length > 0) {
        const { error } = await admin.from('buildings').update(parche).eq('id', b.id);
        if (error) throw new Error(`guardando campos: ${error.message}`);
      }
      await admin.from('hubspot_deals').update({
        dealstage: hsCampos.dealstage,
        updated_at: new Date().toISOString(),
      }).eq('hs_id', b.hs_deal_id);

      // 2) Personas, diagnósticos y llamadas (reutiliza el sync por edificio)
      const stats = await sincronizarEdificioDesdeHubspot(admin, b.id, String(b.hs_deal_id));
      if (stats.owners_creados > 0) {
        incidencias.push({
          building_id: b.id,
          tipo: 'personas_faltaban',
          titulo: `Se han traído ${stats.owners_creados} personas que estaban en HubSpot y no aquí`,
          detalle: { creados: stats.owners_creados, vinculos: stats.vinculos_creados },
          resolucion: 'auto_corregido',
        });
      }
      if (stats.dudosos_nota > 0) {
        incidencias.push({
          building_id: b.id,
          tipo: 'coincidencia_dudosa',
          titulo: `${stats.dudosos_nota} titulares de la nota con coincidencia dudosa`,
          detalle: { dudosos: stats.dudosos_nota },
          resolucion: 'revision_humana',
        });
      }
      if (stats.contactos_hubspot === 0) {
        incidencias.push({
          building_id: b.id,
          tipo: 'sin_personas_en_hubspot',
          titulo: 'El negocio de HubSpot no tiene ningún contacto asociado',
          detalle: { direccion: b.direccion, hs_deal_id: b.hs_deal_id },
          resolucion: 'revision_humana',
        });
      }

      await admin.from('buildings')
        .update({ hs_props_synced_at: new Date().toISOString(), last_synced_at: new Date().toISOString() })
        .eq('id', b.id);
      ok++;
    } catch (e) {
      fallidos++;
      const mensaje = String((e as Error)?.message ?? e);
      errores.push({ building_id: b.id, error: mensaje });
      console.error('[cotejo]', b.id, mensaje);
      incidencias.push({
        building_id: b.id,
        tipo: 'fallo_cotejo',
        titulo: 'No se ha podido cotejar este edificio',
        detalle: { error: mensaje },
        resolucion: 'revision_humana',
      });
    }
  }

  if (incidencias.length > 0) {
    // Lo que ya se ha arreglado solo queda cerrado; sólo abre lo que exige revisión.
    const filas = incidencias.map((i) => ({
      ...i,
      run_id: runId,
      estado: i.resolucion === 'auto_corregido' ? 'corregido' : 'abierta',
    }));

    for (let k = 0; k < filas.length; k += 200) {
      const { error } = await admin.from('cotejo_hubspot_incidencias').insert(filas.slice(k, k + 200));
      if (error) console.error('[cotejo] incidencias:', error.message);
    }
  }

  const { data: run } = await admin.from('cotejo_hubspot_runs')
    .select('procesados, fallidos').eq('id', runId).maybeSingle();
  const { count: pendientes } = await admin.from('buildings')
    .select('id', { count: 'exact', head: true }).is('hs_props_synced_at', null);

  await admin.from('cotejo_hubspot_runs').update({
    procesados: Number(run?.procesados ?? 0) + ok,
    fallidos: Number(run?.fallidos ?? 0) + fallidos,
    ultimo_building_id: edificios[edificios.length - 1].id,
    estado: Number(pendientes ?? 0) === 0 ? 'terminado' : 'en_curso',
    finished_at: Number(pendientes ?? 0) === 0 ? new Date().toISOString() : null,
  }).eq('id', runId);

  return json({
    ok: true,
    run_id: runId,
    procesados_en_esta_pasada: ok,
    fallidos,
    sin_negocio: sinNegocio,
    incidencias_registradas: incidencias.length,
    pendientes: Number(pendientes ?? 0),
    terminado: Number(pendientes ?? 0) === 0,
    errores: errores.slice(0, 5),
  });
});
