// agent_analyze_feedback — clasifica dimensión, diagnostica fallo y propone acción
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-3-flash-preview';

const SYSTEM = `Eres un analista de datos inmobiliarios. Recibes una observación de un comercial sobre un edificio y los datos actuales que el sistema tiene. Debes:
1. Clasificar la observación en una dimensión: escaleras | ventanas | proteccion | cluster | propietarios | m2 | viviendas | otro.
2. Identificar el campo concreto del sistema, su valor actual y el origen del dato (VLM | catastro | heuristica | hubspot | nota_simple).
3. Diagnosticar POR QUÉ el sistema falló (causa raíz, en una frase).
4. Proponer UNA acción:
   - tipo: "override" con { tabla, campo, valor_nuevo, justificacion } si es un dato puntual del edificio.
   - tipo: "constante" con { key, valor_nuevo, justificacion } si requiere ajustar app_settings.
   - tipo: "requiere_codigo" con { descripcion, modulo } si necesita cambio de software (p.ej. integrar nueva capa de datos).
Responde SIEMPRE en JSON estricto sin markdown:
{ "dimension":"...", "campo_actual":"...", "valor_actual":"...", "origen":"...", "diagnostico":"...", "accion": { "tipo":"override|constante|requiere_codigo", ... } }`;

async function callAI(prompt: string): Promise<any> {
  const key = Deno.env.get('LOVABLE_API_KEY');
  if (!key) throw new Error('LOVABLE_API_KEY missing');
  const r = await fetch(AI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`ai ${r.status}: ${t.slice(0, 300)}`);
  }
  const j = await r.json();
  const txt = j?.choices?.[0]?.message?.content ?? '{}';
  try { return JSON.parse(txt); } catch { return { raw: txt }; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { feedback_id } = await req.json();
    if (!feedback_id) return new Response(JSON.stringify({ error: 'feedback_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: fb, error: e1 } = await sb.from('building_feedback').select('*').eq('id', feedback_id).single();
    if (e1 || !fb) throw new Error(e1?.message || 'feedback not found');

    const [bldg, ba, cat, owners] = await Promise.all([
      sb.from('buildings').select('*').eq('id', fb.building_id).single(),
      sb.from('building_analysis').select('*').eq('building_id', fb.building_id).maybeSingle(),
      sb.from('catastro_authority_cache').select('*').eq('building_id', fb.building_id).maybeSingle(),
      sb.from('building_owners').select('id, pct_propiedad, metadatos, owners(nombre)').eq('building_id', fb.building_id).limit(20),
    ]);

    const snapshot = {
      direccion: bldg.data?.direccion ?? bldg.data?.address,
      score: ba.data?.score_total,
      cluster: ba.data?.cluster_label,
      protegido: ba.data?.protegido,
      protegido_raw: ba.data?.protegido_raw,
      escaleras: ba.data?.escaleras ?? cat.data?.n_subparcelas_residenciales,
      ventanas_total: ba.data?.ventanas_total,
      m2_total: ba.data?.m2_total ?? cat.data?.m2_total,
      num_viviendas: ba.data?.num_viviendas ?? cat.data?.viviendas_total,
      origen_viviendas: ba.data?.origen_viviendas,
      propietarios_n: owners.data?.length ?? 0,
    };

    const prompt = `Observación del equipo (canal ${fb.canal}):\n"""${fb.texto || '(vacío)'}"""\n\nDatos actuales del edificio:\n${JSON.stringify(snapshot, null, 2)}`;
    const analisis = await callAI(prompt);

    const dimension = analisis?.dimension || 'otro';
    const tipo = analisis?.accion?.tipo;
    const estado = tipo === 'requiere_codigo' ? 'requiere_codigo' : 'analizada';

    await sb.from('building_feedback').update({
      analisis_ia: analisis,
      dimension,
      estado,
    }).eq('id', feedback_id);

    return new Response(JSON.stringify({ ok: true, analisis }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});