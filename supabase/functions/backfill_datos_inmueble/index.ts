// backfill_datos_inmueble — trae de HubSpot los datos del inmueble de todos los
// edificios con negocio vinculado y los sobrescribe aquí. HubSpot manda.
// SOLO LECTURA sobre HubSpot.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { corsHeaders, hubspotFetch } from '../_shared/hubspot.ts';
import {
  INMUEBLE_DEAL_PROPERTIES,
  aplicarDatosInmueble,
  type CambioInmueble,
} from '../_shared/datosInmueble.ts';

const TANDA = 100; // lectura por lotes de HubSpot

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

  // Autorización: token interno del proceso programado o usuario administrador.
  const secret = req.headers.get('x-cotejo-key') ?? '';
  const authHeader = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  let autorizado = secret === serviceKey || authHeader === serviceKey;
  if (!autorizado && secret) {
    const { data: tok } = await admin.from('internal_tokens')
      .select('token').eq('name', 'cotejo_run').maybeSingle();
    autorizado = !!tok?.token && secret === tok.token;
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
  const rehacer = body.rehacer === true;
  const tope = Math.max(1, Math.min(1500, Number(body.tope ?? 400)));
  const soloEdificio = typeof body.building_id === 'string' ? body.building_id : '';

  // Selección: los que nunca se han leído (o todos, si se pide rehacer).
  let ya: Set<string> = new Set();
  if (!rehacer && !soloEdificio) {
    const { data: hechos } = await admin.from('hs_inmueble_snapshot')
      .select('building_id').limit(5000);
    ya = new Set(((hechos ?? []) as any[]).map((r) => r.building_id));
  }

  let q = admin.from('buildings')
    .select('id, direccion, refcatastral, metros_viviendas, num_viviendas, pct_terciario, pct_residencial, uso_principal, hs_deal_id')
    .not('hs_deal_id', 'is', null)
    .order('id');
  if (soloEdificio) q = q.eq('id', soloEdificio);
  const { data: todos, error: selErr } = await q;
  if (selErr) return json({ ok: false, error: selErr.message }, 500);

  const pendientes = (todos ?? []).filter((b: any) => !ya.has(b.id)).slice(0, tope);
  if (pendientes.length === 0) {
    return json({ ok: true, terminado: true, procesados: 0, restantes: 0 });
  }

  const porDeal = new Map<string, any>();
  for (const b of pendientes) porDeal.set(String(b.hs_deal_id), b);

  const cambiosPorCampo: Record<string, number> = {};
  const detalle: Array<{ building_id: string; direccion: string; cambios: CambioInmueble[] }> = [];
  let leidos = 0, actualizados = 0, fallidos = 0;
  const errores: string[] = [];
  const inicio = Date.now();

  const ids = [...porDeal.keys()];
  for (let i = 0; i < ids.length; i += TANDA) {
    if (Date.now() - inicio > 100_000) break; // deja sitio para responder
    const tanda = ids.slice(i, i + TANDA);
    let res: any;
    try {
      res = await hubspotFetch('/crm/v3/objects/deals/batch/read', {
        method: 'POST',
        body: JSON.stringify({
          properties: INMUEBLE_DEAL_PROPERTIES,
          inputs: tanda.map((id) => ({ id })),
        }),
      });
    } catch (e) {
      fallidos += tanda.length;
      errores.push(String((e as Error).message).slice(0, 300));
      continue;
    }

    for (const r of (res?.results ?? []) as any[]) {
      const b = porDeal.get(String(r.id));
      if (!b) continue;
      leidos++;
      try {
        const cambios = await aplicarDatosInmueble(admin, b, r.properties ?? {});
        if (cambios.length > 0) {
          actualizados++;
          for (const c of cambios) cambiosPorCampo[c.campo] = (cambiosPorCampo[c.campo] ?? 0) + 1;
          if (detalle.length < 50) detalle.push({ building_id: b.id, direccion: b.direccion, cambios });
        }
      } catch (e) {
        fallidos++;
        errores.push(`${b.id}: ${String((e as Error).message).slice(0, 200)}`);
      }
    }
  }

  const { count: hechos } = await admin.from('hs_inmueble_snapshot')
    .select('building_id', { count: 'exact', head: true });
  const { count: total } = await admin.from('buildings')
    .select('id', { count: 'exact', head: true }).not('hs_deal_id', 'is', null);

  return json({
    ok: true,
    leidos,
    actualizados,
    fallidos,
    cambios_por_campo: cambiosPorCampo,
    detalle,
    errores: errores.slice(0, 10),
    cotejados: Number(hechos ?? 0),
    total_con_negocio: Number(total ?? 0),
    terminado: Number(hechos ?? 0) >= Number(total ?? 0),
  });
});
