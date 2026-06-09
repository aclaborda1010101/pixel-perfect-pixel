// apply_feedback_override — aplica override propuesto por IA y recomputa
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const ALLOWED_TABLES = new Set(['building_analysis', 'buildings', 'catastro_authority_cache']);
const ALLOWED_FIELDS: Record<string, Set<string>> = {
  building_analysis: new Set(['protegido','protegido_raw','escaleras','ventanas_total','m2_total','num_viviendas','cluster_label','origen_viviendas','notas_correccion']),
  buildings: new Set(['direccion','metadatos']),
  catastro_authority_cache: new Set(['viviendas_total','m2_total','n_subparcelas_residenciales']),
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { feedback_id, user_email } = await req.json();
    if (!feedback_id) return new Response(JSON.stringify({ error: 'feedback_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const { data: fb, error } = await sb.from('building_feedback').select('*').eq('id', feedback_id).single();
    if (error || !fb) throw new Error(error?.message || 'feedback not found');

    const accion = fb.analisis_ia?.accion;
    if (!accion || accion.tipo !== 'override') throw new Error('No hay override aplicable en este feedback');

    const { tabla, campo, valor_nuevo } = accion;
    if (!ALLOWED_TABLES.has(tabla)) throw new Error(`Tabla no permitida: ${tabla}`);
    if (!ALLOWED_FIELDS[tabla]?.has(campo)) throw new Error(`Campo no permitido: ${tabla}.${campo}`);

    // Capturar valor anterior
    const idCol = tabla === 'buildings' ? 'id' : 'building_id';
    const idVal = fb.building_id;
    const { data: prev } = await sb.from(tabla).select(campo).eq(idCol, idVal).maybeSingle();
    const valor_anterior = prev?.[campo] ?? null;

    const updatePayload: any = { [campo]: valor_nuevo };
    const { error: upErr } = await sb.from(tabla).update(updatePayload).eq(idCol, idVal);
    if (upErr) throw new Error(`update ${tabla}: ${upErr.message}`);

    const override = { tabla, campo, valor_anterior, valor_nuevo, aplicado_en: new Date().toISOString(), aplicado_por: user_email || null };
    await sb.from('building_feedback').update({ estado: 'aplicada', override_aplicado: override }).eq('id', feedback_id);

    // Recompute (fire & forget)
    const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/recompute-cluster-scoring`;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
      body: JSON.stringify({ building_id: fb.building_id }),
    }).catch(() => {});

    return new Response(JSON.stringify({ ok: true, override }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});