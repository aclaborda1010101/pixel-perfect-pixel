// hubspot_snapshot — toma un snapshot de conteos por entidad. Solo lectura.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { corsHeaders } from '../_shared/hubspot.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const entries: Array<{ table: string; entity: string }> = [
    { table: 'buildings', entity: 'buildings' },
    { table: 'owners', entity: 'owners' },
    { table: 'hubspot_tasks', entity: 'tasks' },
    { table: 'hubspot_calls', entity: 'calls' },
    { table: 'hubspot_notes', entity: 'notes' },
    { table: 'hubspot_lists', entity: 'lists' },
    { table: 'hubspot_list_memberships', entity: 'list_memberships' },
  ];
  const out: Record<string, number> = {};
  for (const e of entries) {
    const { count } = await supabase.from(e.table).select('id', { count: 'exact', head: true });
    out[e.entity] = count || 0;
    await supabase.from('hubspot_snapshots').insert({ entity_type: e.entity, total_count: count || 0, metrics: {} });
  }
  return new Response(JSON.stringify({ ok: true, taken_at: new Date().toISOString(), counts: out }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});