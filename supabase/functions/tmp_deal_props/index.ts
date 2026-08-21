// tmp_deal_props — inspección puntual de propiedades de negocio en HubSpot.
import { corsHeaders, hubspotFetch } from '../_shared/hubspot.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const dealId = String((body as any).deal_id ?? '34789707081');
    const filtro = String((body as any).filtro ?? '');
    const schema = await hubspotFetch('/crm/v3/properties/deals');
    const nombres = (schema?.results ?? [])
      .map((p: any) => p.name)
      .filter((n: string) => (filtro ? n.includes(filtro) : true));
    const deal = await hubspotFetch(
      `/crm/v3/objects/deals/${dealId}?properties=${nombres.slice(0, 300).join(',')}`,
    );
    const props = Object.fromEntries(
      Object.entries(deal?.properties ?? {}).filter(([, v]) => v !== null && v !== ''),
    );
    return new Response(JSON.stringify({ nombres, props }, null, 1), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
