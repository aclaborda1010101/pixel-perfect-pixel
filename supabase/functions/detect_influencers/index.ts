// detect_influencers — calcula es_influencer/score/reason por building_owner.
// Heurística: cuota*0.4 + rol_bonus(25) + buyer_persona(20) + calls(cap30,x2) + hubspot_calls(cap15,x1).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { corsHeaders } from '../_shared/hubspot.ts';

const ROL_BONUS = new Set(['heredero_operador', 'apoderado', 'operador_profesional']);

interface OwnerRow {
  owner_id: string;
  cuota: number | null;
  rol_notas: string | null;
  owners: {
    nombre: string;
    rol: string | null;
    buyer_persona: string | null;
    updated_at: string;
    metadatos: Record<string, unknown> | null;
  } | null;
}

async function processBuilding(
  supabase: any,
  buildingId: string,
): Promise<{ winner_owner_id: string | null; ranking: any[] }> {
  const { data: rows } = await supabase
    .from('building_owners')
    .select('owner_id, cuota, rol_notas, owners(nombre, rol, buyer_persona, updated_at, metadatos)')
    .eq('building_id', buildingId);

  const bos = (rows || []) as OwnerRow[];
  if (bos.length < 2) return { winner_owner_id: null, ranking: [] };

  const ownerIds = bos.map((r) => r.owner_id);

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
    const cuota = Number(bo.cuota) || 0;
    const rol = (bo.owners?.rol || 'desconocido') as string;
    const bp = (bo.owners?.buyer_persona || '') as string;
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
      nombre: bo.owners?.nombre,
      score: Math.round(score * 100) / 100,
      cuota,
      updated_at: bo.owners?.updated_at,
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
    let buildingIds: string[] = [];
    if (body.building_id) {
      buildingIds = [body.building_id];
    } else {
      const { data } = await supabase
        .from('building_owners').select('building_id');
      const counts: Record<string, number> = {};
      for (const r of (data || []) as { building_id: string }[]) {
        counts[r.building_id] = (counts[r.building_id] || 0) + 1;
      }
      buildingIds = Object.entries(counts).filter(([, n]) => n > 1).map(([id]) => id);
    }

    let processed = 0;
    let identified = 0;
    const sample: any[] = [];
    for (const bid of buildingIds) {
      const r = await processBuilding(supabase, bid);
      processed++;
      if (r.winner_owner_id) {
        identified++;
        if (sample.length < 3) sample.push({ building_id: bid, ...r.ranking[0] });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      buildings_processed: processed,
      influencers_identified: identified,
      sample_top: sample,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error';
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});