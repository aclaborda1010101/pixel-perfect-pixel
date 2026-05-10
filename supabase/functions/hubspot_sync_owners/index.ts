// hubspot_sync_owners — sincroniza catálogo de comerciales (owners) desde HubSpot
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { hubspotFetch, corsHeaders } from '../_shared/hubspot.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let upserted = 0, pages = 0;
  try {
    for (const archived of [false, true]) {
      let after: string | undefined = undefined;
      for (let p = 0; p < 20; p++) {
        const params = new URLSearchParams();
        params.set('limit', '100');
        params.set('archived', String(archived));
        if (after) params.set('after', after);
        const data = await hubspotFetch(`/crm/v3/owners?${params.toString()}`);
        pages++;
        const results: any[] = data?.results || [];
        if (!results.length) break;
        const rows = results.map((o: any) => ({
          hs_owner_id: String(o.id),
          email: o.email || null,
          first_name: o.firstName || null,
          last_name: o.lastName || null,
          full_name: [o.firstName, o.lastName].filter(Boolean).join(' ').trim() || o.email || String(o.id),
          archived: archived || !!o.archived,
          raw: o,
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }));
        const { error } = await supabase.from('hubspot_owners').upsert(rows, { onConflict: 'hs_owner_id' });
        if (error) throw new Error(error.message);
        upserted += rows.length;
        after = data?.paging?.next?.after;
        if (!after) break;
      }
    }
    return new Response(JSON.stringify({ ok: true, upserted, pages }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: String(e.message || e), upserted }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});