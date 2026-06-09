// agent_analyze_feedback — clasifica dimensión, diagnostica fallo y propone acción
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-3-flash-preview';

const SYSTEM = `Eres un analista de datos inmobiliarios. Recibes una observación de un comercial sobre un edificio y los datos actuales del sistema. Debes proponer cómo corregirlo USANDO EXCLUSIVAMENTE el esquema real listado abajo; cualquier override fuera de esta whitelist es inválido.

ESQUEMA REAL (única nomenclatura admitida):
- tabla "building_analysis": campos protegido (boolean), protegido_raw (jsonb), escaleras (int), ventanas_total (int), m2_total (numeric), num_viviendas (int), cluster_label (text: ultra_prime|flex_living|hospedaje|retail|otro), origen_viviendas (text), notas_correccion (text)
- tabla "catastro_authority_cache": campos viviendas_total (int), m2_total (numeric), n_subparcelas_residenciales (int)
- tabla "buildings": campos metadatos (jsonb)
- tabla "building_owners": campos cuota (numeric), metadatos (jsonb)  -- requiere "owner_id" en el payload

MAPEO POR DIMENSIÓN:
- proteccion → building_analysis.protegido (true/false) y opcionalmente building_analysis.protegido_raw con { manual: { fuente, nota } }
- escaleras → building_analysis.escaleras
- ventanas → building_analysis.ventanas_total
- m2 → catastro_authority_cache.m2_total o building_analysis.m2_total
- viviendas → catastro_authority_cache.viviendas_total
- cluster → building_analysis.cluster_label
- propietarios → building_owners.cuota (con owner_id)
- otro → "requiere_codigo"

PASOS:
1. Clasifica dimension en uno de: escaleras | ventanas | proteccion | cluster | propietarios | m2 | viviendas | otro
2. Identifica campo_actual (en notación tabla.campo del esquema real), valor_actual y origen (VLM | catastro | heuristica | hubspot | nota_simple)
3. Diagnostica POR QUÉ el sistema falló (una frase)
4. Propone UNA acción:
   - override: { tabla, campo, valor_nuevo, justificacion[, owner_id] } — SOLO con tabla/campo de la whitelist
   - constante: { key, valor_nuevo, justificacion }
   - requiere_codigo: { descripcion, modulo }

EJEMPLO (Topete 33, dimensión protección, APE no detectado):
{
  "dimension":"proteccion",
  "campo_actual":"building_analysis.protegido",
  "valor_actual":"false",
  "origen":"heuristica",
  "diagnostico":"ArcGIS layer 5 no cubre APEs distritales y el fuzzy de dirección no encontró match en madrid_edificios_protegidos.",
  "accion": { "tipo":"override", "tabla":"building_analysis", "campo":"protegido", "valor_nuevo": true, "justificacion":"APE Bellas Vistas confirmado manualmente" }
}

Responde SIEMPRE en JSON estricto sin markdown.`;

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