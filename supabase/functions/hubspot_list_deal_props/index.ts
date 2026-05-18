import { corsHeaders } from '../_shared/hubspot.ts';
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const pat = Deno.env.get('HUBSPOT_PAT');
  const res = await fetch('https://api.hubapi.com/crm/v3/properties/deals?archived=false', {
    headers: { 'Authorization': `Bearer ${pat}` },
  });
  const text = await res.text();
  if (!res.ok) return new Response(JSON.stringify({ status: res.status, body: text.slice(0, 500) }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  const data = JSON.parse(text);
  const names = (data?.results || []).map((p: any) => ({ name: p.name, label: p.label, type: p.type }));
  return new Response(JSON.stringify({ count: names.length, names }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
