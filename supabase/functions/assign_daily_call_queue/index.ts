// assign_daily_call_queue — selecciona N propietarios a llamar hoy,
// alternando hot/cold 60/40, y crea building_tasks tipo 'call_queue'.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const N = Math.max(5, Math.min(50, Number(body.n ?? 20)));
    const userId = body.user_id as string | undefined;

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Edificios asignados al user (si se pasa user_id) o todos
    let buildingIds: string[] | null = null;
    if (userId) {
      const { data: assigns } = await sb.from('building_assignments')
        .select('building_id').eq('user_id', userId).eq('status', 'active');
      buildingIds = (assigns ?? []).map((a: any) => a.building_id);
      if (!buildingIds.length) return new Response(JSON.stringify({ ok: true, inserted: 0, reason: 'no_assignments' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Cola desde la vista
    let q = sb.from('v_call_queue_daily').select('*').limit(500);
    if (buildingIds) q = q.in('building_id', buildingIds);
    const { data: queue, error } = await q;
    if (error) throw error;

    const hot = (queue ?? []).filter((r: any) => r.temperatura === 'hot');
    const cold = (queue ?? []).filter((r: any) => r.temperatura === 'cold');
    const nHot = Math.round(N * 0.6);
    const nCold = N - nHot;
    const picked = [...hot.slice(0, nHot), ...cold.slice(0, nCold)];

    // Resolver user destino (el assignment del edificio)
    const inserted: any[] = [];
    for (const row of picked) {
      let assignee = userId;
      if (!assignee) {
        const { data: ba } = await sb.from('building_assignments')
          .select('user_id').eq('building_id', row.building_id).eq('status', 'active').limit(1).maybeSingle();
        assignee = (ba as any)?.user_id;
      }
      if (!assignee) continue;

      const taskKey = `call_queue:${new Date().toISOString().slice(0,10)}:${row.owner_id}`;
      const { data: ins } = await sb.from('building_tasks').upsert({
        building_id: row.building_id,
        user_id: assignee,
        task_type: 'call_queue',
        task_key: taskKey,
        title: `Llamar a ${row.nombre} (${row.temperatura})`,
        description: `Prioridad ${row.prioridad} · score edificio ${row.score_edificio} · cuota ${row.cuota ?? '—'}`,
        priority: row.temperatura === 'hot' ? 'high' : 'medium',
        status: 'pending',
      }, { onConflict: 'building_id,user_id,task_key' }).select('id, building_id').maybeSingle();
      if (ins) inserted.push({ ...ins, owner_id: row.owner_id, temperatura: row.temperatura });
    }

    return new Response(JSON.stringify({ ok: true, inserted: inserted.length, items: inserted }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});