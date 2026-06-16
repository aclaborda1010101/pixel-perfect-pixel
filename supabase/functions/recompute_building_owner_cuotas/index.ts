// recompute_building_owner_cuotas — corrige building_owners.cuota según division_horizontal.
// DH=true → cuota=NULL (la verdad vive en nota_simple_titulares.porcentaje, por finca).
// DH=false → derivar cuota desde la nota_simple_titulares más reciente por owner.
// Marca metadatos.cuota_source y metadatos.cuota_inconsistente si Σ ≠ 100 ±1.
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
      if (!dryRun) {
        await sb.from('building_owners')
          .update({ cuota: null, metadatos: meta })
          .eq('building_id', buildingId).eq('owner_id', r.owner_id);
      }
      if (r.cuota != null) changed.push(r.owner_id);
    }
    return { building_id: buildingId, mode: 'dh', owners: bos.length, nulled: changed.length };
  }

  // No DH: derivar desde nota_simple_titulares (porcentaje de la nota más reciente por owner)
  const ownerIds = bos.map((r: any) => r.owner_id);
  const { data: notasB } = await sb.from('notas_simples')
    .select('id, processed_at, created_at').eq('building_id', buildingId);
  const notaIds = (notasB ?? []).map((n: any) => n.id);
  const dateMap = new Map<string, string>((notasB ?? []).map((n: any) => [n.id, n.processed_at ?? n.created_at ?? '']));
  const titMap = new Map<string, { porc: number | null; when: string }>();
  if (notaIds.length) {
    const { data: tits } = await sb.from('nota_simple_titulares')
      .select('owner_id, porcentaje, nota_simple_id')
      .in('nota_simple_id', notaIds).in('owner_id', ownerIds);
    for (const t of (tits ?? [])) {
      if (!t.owner_id) continue;
      const when = dateMap.get(t.nota_simple_id) ?? '';
      const cur = titMap.get(t.owner_id);
      if (!cur || when > cur.when) titMap.set(t.owner_id, { porc: t.porcentaje, when });
    }
  }
  let sum = 0; const updates: any[] = [];
  for (const r of bos) {
    const t = titMap.get(r.owner_id);
    const porc = t?.porc != null ? Number(t.porc) : (r.cuota != null ? Number(r.cuota) : null);
    if (porc != null && isFinite(porc)) sum += porc;
    updates.push({ owner_id: r.owner_id, cuota: porc, prev: r.cuota, meta: r.metadatos ?? {} });
  }
  const inconsistente = !(sum >= 99 && sum <= 101);
  let changed = 0;
  for (const u of updates) {
    const newMeta = { ...u.meta, cuota_source: 'derived_from_nota_simple' };
    if (inconsistente) (newMeta as any).cuota_inconsistente = true;
    else delete (newMeta as any).cuota_inconsistente;
    const same = (u.prev == null && u.cuota == null) || (Number(u.prev) === Number(u.cuota));
    if (!dryRun) {
      await sb.from('building_owners')
        .update({ cuota: u.cuota, metadatos: newMeta })
        .eq('building_id', buildingId).eq('owner_id', u.owner_id);
    }
    if (!same) changed++;
  }
  return { building_id: buildingId, mode: 'no_dh', owners: bos.length, sum_pct: Math.round(sum * 100) / 100, inconsistente, changed };
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
    let dh = 0, noDH = 0, incons = 0;
    for (const id of chunk) {
      const r = await processBuilding(sb, id, dryRun);
      results.push(r);
      if (r.mode === 'dh') dh++;
      if (r.mode === 'no_dh') { noDH++; if ((r as any).inconsistente) incons++; }
    }
    await sb.from('agent_runs').insert({
      agent_name: 'recompute_building_owner_cuotas', scope_type: 'system', scope_id: null,
      resultado: { processed: chunk.length, dh, no_dh: noDH, inconsistentes: incons, dry_run: dryRun },
    });
    return new Response(JSON.stringify({
      ok: true, processed: chunk.length, dh, no_dh: noDH, inconsistentes: incons,
      remaining: Math.max(0, ids.length - chunk.length), dry_run: dryRun,
      sample: results.slice(0, 8),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});