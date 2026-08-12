// TEMPORAL — verificación de cadencias con datos reales. Se elimina tras el reporte.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { agruparLlamadas, calcularCadencia } from '../_shared/cadencias.ts';

Deno.serve(async (req) => {
  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, service, { auth: { persistSession: false } });
  let body: any = {};
  try { body = await req.json(); } catch { /* noop */ }
  const userId = String(body.p_user_id ?? '');
  const runs = Number(body.runs ?? 0);

  const out: any = { generaciones: [] };

  if (body.mode === 'situaciones') {
    const { data: asigs } = await admin.from('building_assignments')
      .select('building_id').eq('user_id', userId).eq('status', 'active');
    const ids = [...new Set((asigs ?? []).map((a: any) => a.building_id))];
    const edificios: any[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data } = await admin.from('buildings').select('id,direccion,estado')
        .eq('porcentajes_estado', 'verificado').in('id', ids.slice(i, i + 100));
      edificios.push(...(data ?? []));
    }
    const eids = edificios.map((b) => b.id);
    const props: any[] = [];
    for (let i = 0; i < eids.length; i += 100) {
      const { data } = await admin.from('v_owner_score')
        .select('owner_id,building_id,score').in('building_id', eids.slice(i, i + 100));
      props.push(...(data ?? []));
    }
    const ownerIds = [...new Set(props.map((p) => p.owner_id).filter(Boolean))];
    const calls: any[] = [];
    for (let i = 0; i < ownerIds.length; i += 200) {
      const { data } = await admin.from('calls')
        .select('owner_id,fecha,outcome,sentiment,duracion_seg').in('owner_id', ownerIds.slice(i, i + 200));
      calls.push(...(data ?? []));
    }
    const porProp = agruparLlamadas(calls);
    const estados = new Map(edificios.map((b) => [b.id, b.estado]));
    const conteo: Record<string, number> = {};
    const muestras: any[] = [];
    for (const p of props) {
      const cad = calcularCadencia({
        llamadas: porProp.get(String(p.owner_id)) ?? [],
        estadoEdificio: estados.get(p.building_id) ?? null,
      });
      conteo[cad.situacion] = (conteo[cad.situacion] ?? 0) + 1;
      conteo[`${cad.situacion}|elegible=${cad.elegible}`] = (conteo[`${cad.situacion}|elegible=${cad.elegible}`] ?? 0) + 1;
      if (muestras.length < 12) muestras.push({ owner_id: p.owner_id, building_id: p.building_id, situacion: cad.situacion, elegible: cad.elegible, desde: cad.elegibleDesde.toISOString().slice(0, 10), accion: cad.accion });
    }
    return Response.json({ ok: true, edificios: edificios.length, propietarios: props.length, conteo, muestras });
  }

  for (let i = 0; i < runs; i++) {
    const r = await fetch(`${url}/functions/v1/generate_next_task`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${service}`, apikey: service, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user_id: userId }),
    });
    out.generaciones.push(await r.json());
  }
  return Response.json(out);
});
