// recompute_building_owner_cuotas — corrige building_owners.cuota según division_horizontal.
// DH=true → cuota=NULL (la verdad vive en nota_simple_titulares.porcentaje, por finca).
// DH=false → derivar cuota SOLO desde pleno dominio verificado (v_rights_cuota_eligible).
//   Nunca se toma un porcentaje sin filtrar la capa de derecho: usufructo / nuda propiedad
//   jamás alimentan building_owners.cuota. Si el edificio no está apto (v_building_rights_status)
//   se BLOQUEA: cuota=NULL + metadatos.cuota_bloqueada con el motivo.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { corsHeaders } from '../_shared/hubspot.ts';

async function processBuilding(sb: any, buildingId: string, dryRun: boolean) {
  const { data: b } = await sb.from('buildings')
    .select('id, division_horizontal').eq('id', buildingId).maybeSingle();
  if (!b) return { building_id: buildingId, skipped: 'not_found' };

  const { data: bos } = await sb.from('building_owners')
    .select('owner_id, cuota, metadatos').eq('building_id', buildingId);
  if (!bos || bos.length === 0) return { building_id: buildingId, skipped: 'no_owners' };

  if (b.division_horizontal) {
    // DH: cuota=NULL para todos
    const changed: string[] = [];
    for (const r of bos) {
      const meta = { ...(r.metadatos ?? {}), cuota_source: 'dh_por_finca' };
      delete (meta as any).cuota_inconsistente;
      delete (meta as any).cuota_bloqueada;
      delete (meta as any).cuota_bloqueo_motivo;
      if (!dryRun) {
        await sb.from('building_owners')
          .update({ cuota: null, metadatos: meta })
          .eq('building_id', buildingId).eq('owner_id', r.owner_id);
      }
      if (r.cuota != null) changed.push(r.owner_id);
    }
    return { building_id: buildingId, mode: 'dh', owners: bos.length, nulled: changed.length };
  }

  // No DH: SOLO pleno dominio verificado. Gate por v_building_rights_status.
  const { data: status } = await sb.from('v_building_rights_status')
    .select('apto_para_cuota, bloqueos').eq('building_id', buildingId).maybeSingle();
  const { data: elig } = await sb.from('v_rights_cuota_eligible')
    .select('owner_id, pct_pleno').eq('building_id', buildingId);

  const plenoMap = new Map<string, number>();
  for (const r of (elig ?? [])) {
    if (!r.owner_id || r.pct_pleno == null) continue;
    // si un owner aparece en varias fincas/notas, se acumula su pleno dominio
    plenoMap.set(r.owner_id, (plenoMap.get(r.owner_id) ?? 0) + Number(r.pct_pleno));
  }
  const sum = Array.from(plenoMap.values()).reduce((a, v) => a + v, 0);
  const sumaOk = sum >= 99 && sum <= 101;
  const apto = !!status?.apto_para_cuota && plenoMap.size > 0 && sumaOk;

  if (!apto) {
    // BLOQUEO: no se escribe ninguna cuota derivada de una capa no verificada.
    const motivo = !status
      ? 'sin_estado_de_derechos'
      : !status.apto_para_cuota
        ? (status.bloqueos ?? ['gate_derechos']).join(',')
        : plenoMap.size === 0 ? 'sin_pleno_dominio_verificado' : 'suma_pleno_no_100';
    let nulled = 0;
    for (const r of bos) {
      const meta = {
        ...(r.metadatos ?? {}),
        cuota_source: 'bloqueada_gate_derechos',
        cuota_bloqueada: true,
        cuota_bloqueo_motivo: motivo,
      };
      delete (meta as any).cuota_inconsistente;
      if (!dryRun) {
        await sb.from('building_owners')
          .update({ cuota: null, metadatos: meta })
          .eq('building_id', buildingId).eq('owner_id', r.owner_id);
      }
      if (r.cuota != null) nulled++;
    }
    return {
      building_id: buildingId, mode: 'bloqueado', owners: bos.length,
      motivo, sum_pct: Math.round(sum * 100) / 100, nulled,
    };
  }

  let changed = 0;
  for (const r of bos) {
    const porc = plenoMap.has(r.owner_id) ? plenoMap.get(r.owner_id)! : null;
    const newMeta = {
      ...(r.metadatos ?? {}),
      cuota_source: 'pleno_dominio_verificado',
    };
    delete (newMeta as any).cuota_inconsistente;
    delete (newMeta as any).cuota_bloqueada;
    delete (newMeta as any).cuota_bloqueo_motivo;
    const same = (r.cuota == null && porc == null) || (Number(r.cuota) === Number(porc));
    if (!dryRun) {
      await sb.from('building_owners')
        .update({ cuota: porc, metadatos: newMeta })
        .eq('building_id', buildingId).eq('owner_id', r.owner_id);
    }
    if (!same) changed++;
  }
  return {
    building_id: buildingId, mode: 'no_dh', owners: bos.length,
    sum_pct: Math.round(sum * 100) / 100, inconsistente: false, changed,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: any = {}; try { body = await req.json(); } catch {}
  const dryRun = !!body.dry_run;
  const max = Number(body.max_buildings) || 500;

  try {
    let ids: string[] = [];
    if (body.building_id) ids = [body.building_id];
    else {
      const seen = new Set<string>();
      let from = 0; const P = 1000;
      while (true) {
        const { data, error } = await sb.from('building_owners')
          .select('building_id').range(from, from + P - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const r of data as { building_id: string }[]) seen.add(r.building_id);
        if (data.length < P) break;
        from += P;
      }
      ids = Array.from(seen).sort();
    }
    const chunk = ids.slice(0, max);
    const results: any[] = [];
    let dh = 0, noDH = 0, bloqueados = 0;
    for (const id of chunk) {
      const r = await processBuilding(sb, id, dryRun);
      results.push(r);
      if (r.mode === 'dh') dh++;
      if (r.mode === 'no_dh') noDH++;
      if (r.mode === 'bloqueado') bloqueados++;
    }
    await sb.from('agent_runs').insert({
      agent_name: 'recompute_building_owner_cuotas', scope_type: 'system', scope_id: null,
      resultado: { processed: chunk.length, dh, no_dh: noDH, bloqueados, dry_run: dryRun },
    });
    return new Response(JSON.stringify({
      ok: true, processed: chunk.length, dh, no_dh: noDH, bloqueados,
      remaining: Math.max(0, ids.length - chunk.length), dry_run: dryRun,
      sample: results.slice(0, 8),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});