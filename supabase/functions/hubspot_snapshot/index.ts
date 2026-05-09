// hubspot_snapshot — toma un snapshot de conteos por entidad. Solo lectura.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { corsHeaders } from '../_shared/hubspot.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const entries: Array<{ table: string; entity: string; pkCol: string }> = [
    { table: 'buildings', entity: 'buildings', pkCol: 'id' },
    { table: 'owners', entity: 'owners', pkCol: 'id' },
    { table: 'hubspot_tasks', entity: 'tasks', pkCol: 'id' },
    { table: 'hubspot_calls', entity: 'calls', pkCol: 'id' },
    { table: 'hubspot_notes', entity: 'notes', pkCol: 'id' },
    { table: 'hubspot_lists', entity: 'lists', pkCol: 'id' },
    { table: 'hubspot_list_memberships', entity: 'list_memberships', pkCol: 'hs_list_id' },
  ];
  const out: Record<string, number> = {};
  for (const e of entries) {
    const { count } = await supabase.from(e.table).select(e.pkCol, { count: 'exact', head: true });
    out[e.entity] = count || 0;
    await supabase.from('hubspot_snapshots').insert({ entity_type: e.entity, total_count: count || 0, metrics: {} });
  }
  return new Response(JSON.stringify({ ok: true, taken_at: new Date().toISOString(), counts: out }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});