// TEMPORAL — verificación de la sincronización por edificio. Se borra tras la prueba.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { corsHeaders } from '../_shared/hubspot.ts';
import { sincronizarEdificioDesdeHubspot, tomarFoto } from '../_shared/hubspotBuildingSync.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const body = await req.json();
  const id = String(body.building_id);
  const { data: b } = await admin.from('buildings').select('hs_deal_id').eq('id', id).maybeSingle();
  const antes = await tomarFoto(admin, id);
  const stats = await sincronizarEdificioDesdeHubspot(admin, id, String(b?.hs_deal_id));
  const despues = await tomarFoto(admin, id);
  return new Response(JSON.stringify({ ok: true, antes, despues, stats }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
