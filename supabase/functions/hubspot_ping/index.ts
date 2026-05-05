// hubspot_ping — health check de la conexión HubSpot vía gateway
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/hubspot';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startedAt = Date.now();
  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');

    const HUBSPOT_API_KEY = Deno.env.get('HUBSPOT_API_KEY');
    if (!HUBSPOT_API_KEY) throw new Error('HUBSPOT_API_KEY is not configured');

    // Llamada ligera: account-info (devuelve portalId, currency, timeZone)
    const res = await fetch(`${GATEWAY_URL}/account-info/v3/details`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': HUBSPOT_API_KEY,
      },
    });

    const latency_ms = Date.now() - startedAt;
    const body = await res.json().catch(() => ({}));

    if (!res.ok) {
      return new Response(JSON.stringify({
        ok: false,
        status: res.status,
        latency_ms,
        error: body?.message || `HubSpot returned ${res.status}`,
        details: body,
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      latency_ms,
      portal_id: body?.portalId ?? null,
      time_zone: body?.timeZone ?? null,
      currency: body?.companyCurrency ?? null,
      utc_offset: body?.utcOffset ?? null,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[hubspot_ping] error:', msg);
    return new Response(JSON.stringify({
      ok: false,
      latency_ms: Date.now() - startedAt,
      error: msg,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});