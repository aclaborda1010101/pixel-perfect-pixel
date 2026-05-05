// hubspot_sync_health — estado consolidado de la sincronización HubSpot.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { corsHeaders } from '../_shared/hubspot.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const { data: states } = await supabase
      .from('hubspot_sync_state')
      .select('*')
      .order('entity');

    const { data: recentLogs } = await supabase
      .from('hubspot_sync_log')
      .select('id, entity, started_at, finished_at, status, pages_fetched, records_upserted, records_failed, error_message')
      .order('started_at', { ascending: false })
      .limit(10);

    const { count: buildingsSynced } = await supabase
      .from('external_ids').select('id', { count: 'exact', head: true })
      .eq('provider', 'hubspot').eq('provider_object_type', 'deal');

    const { count: ownersSynced } = await supabase
      .from('external_ids').select('id', { count: 'exact', head: true })
      .eq('provider', 'hubspot').eq('provider_object_type', 'contact');

    const { count: buildingsTotal } = await supabase
      .from('buildings').select('id', { count: 'exact', head: true });

    const { count: ownersTotal } = await supabase
      .from('owners').select('id', { count: 'exact', head: true });

    return new Response(JSON.stringify({
      ok: true,
      states: states || [],
      recent_logs: recentLogs || [],
      counts: {
        buildings_total: buildingsTotal || 0,
        buildings_from_hubspot: buildingsSynced || 0,
        owners_total: ownersTotal || 0,
        owners_from_hubspot: ownersSynced || 0,
      },
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});