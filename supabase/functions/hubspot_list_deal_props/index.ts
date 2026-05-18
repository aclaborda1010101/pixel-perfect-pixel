import { hubspotFetch, corsHeaders } from '../_shared/hubspot.ts';
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const data = await hubspotFetch('/crm/v3/properties/deals?archived=false');
  const names = (data?.results || []).map((p: any) => ({ name: p.name, label: p.label, type: p.type }));
  return new Response(JSON.stringify({ count: names.length, names }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
