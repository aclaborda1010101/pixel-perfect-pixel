// detect_division_horizontal — marca buildings.division_horizontal=true cuando hay evidencia.
// Heurística: ≥2 notas_simples con distinta finca registral (numero+registro) o distinta ref_catastral.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { corsHeaders } from '../_shared/hubspot.ts';

function fincaKey(sj: any): string | null {
  if (!sj || typeof sj !== 'object') return null;
  const f = sj.finca ?? {};
  const rc = (f.ref_catastral ?? '').toString().trim().toUpperCase();
  if (rc && rc !== 'NO CONSTA' && rc.length >= 8) return `RC:${rc}`;
  const num = (f.numero ?? '').toString().trim();
  const reg = (f.registro ?? '').toString().trim().toUpperCase().replace(/\s+/g, ' ');
  if (num && reg) return `R:${reg}|N:${num}`;
  if (num) return `N:${num}`;
  return null;
}

async function processBuilding(sb: any, buildingId: string, dryRun: boolean) {
  const { data: notas } = await sb.from('notas_simples')
    .select('id, structured_json').eq('building_id', buildingId);
  const keys = new Set<string>();
  let withoutKey = 0;
  for (const n of (notas ?? [])) {
    const k = fincaKey(n.structured_json);
    if (k) keys.add(k); else withoutKey++;
  }
  const nFincas = keys.size;
  // Señal adicional: si la suma de cuotas de building_owners supera 105%, el edificio
  // es DH casi con seguridad (cada cuota es % de su finca, no del edificio).
  const { data: bo } = await sb.from('building_owners')
    .select('cuota').eq('building_id', buildingId).not('cuota', 'is', null);
  const sumCuota = (bo ?? []).reduce((s: number, r: any) => s + Number(r.cuota || 0), 0);
  const cuotaExcedida = sumCuota > 105;
  // DH si hay >=2 fincas distintas con identificador claro, o cuota total absurda
  const isDH = nFincas >= 2 || cuotaExcedida;
  const evidence = {
    n_notas: (notas ?? []).length,
    n_fincas_distintas: nFincas,
    sin_identificador: withoutKey,
    sum_cuota: Math.round(sumCuota * 10) / 10,
    cuota_excedida: cuotaExcedida,
  };

  const { data: b } = await sb.from('buildings')
    .select('id, division_horizontal, metadatos').eq('id', buildingId).maybeSingle();
  if (!b) return { building_id: buildingId, changed: false, evidence };

  const wantedDH = isDH ? true : b.division_horizontal; // nunca rebajar true→false
  const meta = { ...(b.metadatos ?? {}), dh_evidence: evidence, dh_audited_at: new Date().toISOString() };
  if (!isDH && (notas ?? []).length >= 2) (meta as any).dh_needs_review = true;

  const changed = wantedDH !== b.division_horizontal;
  if (!dryRun) {
    await sb.from('buildings').update({
      division_horizontal: wantedDH, metadatos: meta,
    }).eq('id', buildingId);
  }
  return { building_id: buildingId, changed, set_dh: wantedDH, evidence };
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
      // todos los buildings que tengan al menos una nota
      const seen = new Set<string>();
      let from = 0; const P = 1000;
      while (true) {
        const { data, error } = await sb.from('notas_simples')
          .select('building_id').not('building_id', 'is', null).range(from, from + P - 1);
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
    let changed = 0, dhTrue = 0;
    for (const id of chunk) {
      const r = await processBuilding(sb, id, dryRun);
      results.push(r);
      if (r.changed) changed++;
      if (r.set_dh) dhTrue++;
    }
    await sb.from('agent_runs').insert({
      agent_name: 'detect_division_horizontal', scope_type: 'system', scope_id: null,
      resultado: { processed: chunk.length, changed, dh_true_total: dhTrue, dry_run: dryRun },
    });
    return new Response(JSON.stringify({
      ok: true, processed: chunk.length, changed, dh_true_total: dhTrue,
      remaining: Math.max(0, ids.length - chunk.length), dry_run: dryRun,
      sample: results.slice(0, 5),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});