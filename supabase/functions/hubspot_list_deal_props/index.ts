import { hubspotFetch, corsHeaders } from '../_shared/hubspot.ts';
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  // Get a single deal with no properties param → returns default ones only.
  // Workaround: try the search endpoint sorted by lastmodified.
  try {
    const data = await hubspotFetch('/crm/v3/objects/deals?limit=1');
    return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
