// Trae de HubSpot los contactos de los edificios que tienen negocio vinculado
// y CERO propietarios cargados. Solo lectura sobre HubSpot.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { corsHeaders } from '../_shared/hubspot.ts';
import { sincronizarEdificioDesdeHubspot } from '../_shared/hubspotBuildingSync.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* sin cuerpo */ }
  const limite = Math.min(Number(body.limite ?? 25) || 25, 40);
  const soloVerificados = body.solo_verificados === true;

  // Edificios con negocio y sin ninguna fila en building_owners
  const { data: candidatos, error } = await admin.rpc('edificios_sin_propietarios_con_deal', {
    p_limit: limite,
    p_solo_verificados: soloVerificados,
    p_offset: Math.max(Number(body.offset ?? 0) || 0, 0),
  });
  if (error) return json({ ok: false, error: error.message }, 500);

  const resultados: unknown[] = [];
  let personas = 0, poblados = 0;
  for (const c of (candidatos ?? []) as Array<{ id: string; hs_deal_id: string; direccion: string }>) {
    try {
      const stats = await sincronizarEdificioDesdeHubspot(admin, c.id, String(c.hs_deal_id));
      const { count } = await admin
        .from('building_owners').select('owner_id', { count: 'exact', head: true }).eq('building_id', c.id);
      if ((count ?? 0) > 0) { poblados++; personas += count ?? 0; }
      await admin.from('buildings').update({ last_synced_at: new Date().toISOString() }).eq('id', c.id);
      resultados.push({ id: c.id, direccion: c.direccion, propietarios: count ?? 0, stats });
    } catch (e) {
      resultados.push({ id: c.id, direccion: c.direccion, error: String((e as Error)?.message ?? e) });
    }
  }

  // Recalcula estados: nada verificado sin propietarios
  const { data: corregidos } = await admin.rpc('corregir_estados_incoherentes');

  return json({
    ok: true, procesados: resultados.length, poblados, personas, corregidos, resultados,
  });
});
