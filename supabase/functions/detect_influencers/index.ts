// detect_influencers — calcula es_influencer/score/reason por building_owner.
// Heurística: cuota*0.4 + rol_bonus(25) + buyer_persona(20) + calls(cap30,x2) + hubspot_calls(cap15,x1).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { corsHeaders } from '../_shared/hubspot.ts';

const ROL_BONUS = new Set(['heredero_operador', 'apoderado', 'operador_profesional']);

interface BORow {
  owner_id: string;
  cuota: number | null;
  rol_notas: string | null;
}
interface OwnerInfo {
  id: string;
  nombre: string;
  rol: string | null;
  buyer_persona: string | null;
  updated_at: string;
}

async function processBuilding(
  supabase: any,
  buildingId: string,
): Promise<{ winner_owner_id: string | null; ranking: any[] }> {
  const { data: rows, error: boErr } = await supabase
    .from('building_owners')
    .select('owner_id, cuota, rol_notas')
    .eq('building_id', buildingId);
  if (boErr) throw boErr;

  const bos = (rows || []) as BORow[];
  if (bos.length < 2) return { winner_owner_id: null, ranking: [] };

  const ownerIds = bos.map((r) => r.owner_id);
  const { data: ownersData } = await supabase
    .from('owners').select('id, nombre, rol, buyer_persona, updated_at')
    .in('id', ownerIds);
  const ownerMap = new Map<string, OwnerInfo>();
  for (const o of (ownersData || []) as OwnerInfo[]) ownerMap.set(o.id, o);

  // count calls operativos por owner
  const callsByOwner: Record<string, number> = {};
  for (const oid of ownerIds) {
    const { count } = await supabase
      .from('calls').select('id', { count: 'exact', head: true }).eq('owner_id', oid);
    callsByOwner[oid] = count || 0;
  }

  // count hubspot_calls por owner via external_ids -> contact -> associated_contact_ids
  const hsCallsByOwner: Record<string, number> = {};
  for (const oid of ownerIds) {
    const { data: ext } = await supabase
      .from('external_ids').select('provider_id')
      .eq('entity_type', 'owner').eq('entity_id', oid)
      .eq('provider', 'hubspot').eq('provider_object_type', 'contact').maybeSingle();
    if (!ext?.provider_id) { hsCallsByOwner[oid] = 0; continue; }
    const { count } = await supabase
      .from('hubspot_calls').select('id', { count: 'exact', head: true })
      .contains('associated_contact_ids', [ext.provider_id]);
    hsCallsByOwner[oid] = count || 0;
  }

  const ranking = bos.map((bo) => {
    const o = ownerMap.get(bo.owner_id);
    const cuota = Number(bo.cuota) || 0;
    const rol = (o?.rol || 'desconocido') as string;
    const bp = (o?.buyer_persona || '') as string;
    const cOp = Math.min(callsByOwner[bo.owner_id] || 0, 30);
    const cHs = Math.min(hsCallsByOwner[bo.owner_id] || 0, 15);
    const rolBonus = ROL_BONUS.has(rol) ? 25 : 0;
    const bpBonus = bp === 'controla' ? 20 : 0;
    const score = cuota * 0.4 + rolBonus + bpBonus + cOp * 2 + cHs * 1;
    const reasonParts: string[] = [];
    if (cuota > 0) reasonParts.push(`cuota ${cuota}%`);
    if (rolBonus) reasonParts.push(`rol ${rol}`);
    if (bpBonus) reasonParts.push(`buyer_persona controla`);
    if (cOp > 0) reasonParts.push(`${callsByOwner[bo.owner_id]} llamadas`);
    if (cHs > 0) reasonParts.push(`${hsCallsByOwner[bo.owner_id]} hs_calls`);
    return {
      owner_id: bo.owner_id,
      nombre: o?.nombre,
      score: Math.round(score * 100) / 100,
      cuota,
      updated_at: o?.updated_at,
      reason: reasonParts.join(' + ') || 'sin señales',
    };
  });

  ranking.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if ((b.cuota || 0) !== (a.cuota || 0)) return (b.cuota || 0) - (a.cuota || 0);
    return (b.updated_at || '').localeCompare(a.updated_at || '');
  });

  const winner = ranking[0];

  // Reset all to false primero
  await supabase.from('building_owners')
    .update({ es_influencer: false, influencer_score: null, influencer_reason: null })
    .eq('building_id', buildingId);

  // Set winner
  await supabase.from('building_owners')
    .update({ es_influencer: true, influencer_score: winner.score, influencer_reason: winner.reason })
    .eq('building_id', buildingId).eq('owner_id', winner.owner_id);

  // Update non-winners with score+reason but es_influencer=false
  for (const r of ranking.slice(1)) {
    await supabase.from('building_owners')
      .update({ influencer_score: r.score, influencer_reason: r.reason })
      .eq('building_id', buildingId).eq('owner_id', r.owner_id);
  }

  await supabase.from('agent_runs').insert({
    agent_name: 'detect_influencers',
    scope_type: 'building',
    scope_id: buildingId,
    resultado: { ranking, winner_owner_id: winner.owner_id },
  });

  return { winner_owner_id: winner.owner_id, ranking };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: { building_id?: string } = {};
  try { body = await req.json(); } catch { /* */ }

  try {
    const MAX_BUILDINGS = Number((body as any).max_buildings) || 60;
    let buildingIds: string[] = [];
    if (body.building_id) {
      buildingIds = [body.building_id];
    } else {
      // Page through building_owners (Supabase 1000 cap) to find multi-owner buildings
      const counts: Record<string, number> = {};
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data: rows, error } = await supabase
          .from('building_owners').select('building_id').range(from, from + PAGE - 1);
        if (error) throw error;
        if (!rows || rows.length === 0) break;
        for (const r of rows as { building_id: string }[]) {
          counts[r.building_id] = (counts[r.building_id] || 0) + 1;
        }
        if (rows.length < PAGE) break;
        from += PAGE;
      }
      const multi = Object.entries(counts).filter(([, n]) => n > 1).map(([id]) => id);
      // Skip already-processed buildings (any row with es_influencer=true)
      const done = new Set<string>();
      const dPAGE = 1000;
      let dFrom = 0;
      while (true) {
        const { data: rows, error } = await supabase
          .from('building_owners').select('building_id').eq('es_influencer', true)
          .range(dFrom, dFrom + dPAGE - 1);
        if (error) throw error;
        if (!rows || rows.length === 0) break;
        for (const r of rows as { building_id: string }[]) done.add(r.building_id);
        if (rows.length < dPAGE) break;
        dFrom += dPAGE;
      }
      buildingIds = multi.filter((id) => !done.has(id)).sort();
    }

    const totalRemaining = buildingIds.length;
    const chunk = buildingIds.slice(0, MAX_BUILDINGS);

    let processed = 0;
    let identified = 0;
    const sample: any[] = [];
    for (const bid of chunk) {
      const r = await processBuilding(supabase, bid);
      processed++;
      if (r.winner_owner_id) {
        identified++;
        if (sample.length < 3) sample.push({ building_id: bid, ...r.ranking[0] });
      }
    }

    const remaining = Math.max(0, totalRemaining - processed);
    return new Response(JSON.stringify({
      ok: true,
      buildings_processed: processed,
      influencers_identified: identified,
      remaining,
      done: remaining === 0,
      sample_top: sample,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error';
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});