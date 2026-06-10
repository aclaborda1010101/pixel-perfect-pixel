// agent_analyze_feedback — clasifica dimensión, diagnostica fallo y propone acción
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const MODEL = 'google/gemini-3-flash-preview';

const SYSTEM = `Eres un INGENIERO de calidad de datos inmobiliarios. NO se trata de corregir el síntoma: tienes que diagnosticar el MÉTODO (detector) que produjo el dato erróneo y proponer QUÉ CAMBIAR en el método para que no vuelva a fallar.

CATÁLOGO DE DETECTORES (escoge uno en "detector.nombre"):
- "stair-detector" — cuenta cajas de escalera; ubic: supabase/functions/recount-escaleras + analyze-building-vision (plano FXCC, planta 1). Falla típica: confunde pasillo con escalera en planta baja; FXCC ausente; subparcelas DNPRC mal mapeadas.
- "corner-detector" — detecta si la parcela es esquina; ubic: supabase/functions/_shared/parcel_geometry.ts (regla angular 60-120° entre fachadas, ahora también nº de viales). Falla típica: edificios en chaflán con paño único.
- "facade-window" — cuenta ventanas de fachada desde Street View; ubic: supabase/functions/count-facade-windows (VLM). Falla: oclusión por árboles, andamios, fachada inclinada.
- "patio-window" — estima ventanas a patio desde plano + Google Earth oblicua; ubic: count-patio-windows (heurística sobre patios_detectados × paredes × plantas).
- "cluster" — asigna tesis al edificio; ubic: recompute-cluster-scoring (reglas + barrio + features). Falla: edificio no encaja en cluster mapeado o features mal estimadas (m2/viv, ventanas).
- "proteccion" — comprueba protección histórica/APE; ubic: check-proteccion-pgou + tabla madrid_edificios_protegidos + ArcGIS layer 5. Falla: APE distrital no cubierto por ArcGIS, fuzzy de dirección falla.
- "viviendas" / "m2" — autoridad Catastro (catastro_authority_cache) + parser DNPRC.
- "propietarios" — building_owners poblado por nota simple/HubSpot.

DEVUELVE SIEMPRE este JSON estricto (sin markdown):
{
  "dimension": "esquina|escaleras|ventanas|cluster|proteccion|propietarios|m2|viviendas|otro",
  "detector": { "nombre": "<del catálogo>", "ubicacion": "<archivo/función>" },
  "entrada": { "fuente": "<qué imagen/PDF/dato usó>", "regla_usada": "<heurística/prompt/umbral>" },
  "causa_raiz": "hipótesis concreta de por qué el método falló en ESTE edificio",
  "que_cambiar": {
    "tipo": "regla|prompt|constante|umbral|dato_sucio|requiere_codigo",
    "detalle": "qué hay que ajustar exactamente",
    "donde": "archivo::función o app_settings.<key>"
  },
  "override_puntual": {
    "aplicable": true|false,
    "tabla": "building_analysis|buildings|catastro_authority_cache|building_owners",
    "campo": "<columna real>",
    "valor_nuevo": <valor>,
    "justificacion": "..."
  },
  "diagnostico": "frase humana corta",
  "campo_actual": "tabla.campo",
  "valor_actual": "...",
  "origen": "VLM|catastro|heuristica|hubspot|nota_simple|street_view",
  "accion": { "tipo": "override|constante|requiere_codigo", "tabla": "...", "campo": "...", "valor_nuevo": "..." }
}

ESQUEMA REAL para override_puntual (única nomenclatura admitida):
- building_analysis: esquina (bool), protegido_historicamente (bool), n_escaleras_final (int), ventanas_fachada_total (int), ventanas_patios_estimadas (int), patios_detectados (int), segundas_escaleras (bool), protegido_raw (jsonb)
- buildings: cluster_asignado (text), metadatos (jsonb)
- catastro_authority_cache: viviendas_total (int), m2_total (numeric), n_subparcelas_residenciales (int)
- building_owners: cuota (numeric)  -- requiere owner_id

REGLAS:
1. "accion" se conserva por compatibilidad: si override_puntual.aplicable=true, copia los mismos campos en accion con tipo="override". Si el problema requiere cambiar código/regla/prompt sin override puntual viable, accion.tipo="requiere_codigo".
2. El objetivo es el método. Si el feedback dice "Cava Baja 42 es esquina" y el detector es corner-detector con regla angular, causa_raiz debe explicar la limitación angular y que_cambiar.tipo debe ser "regla" apuntando a parcel_geometry.ts.
3. Si la entrada del feedback viene de "verificacion_inline" (ver metadatos.detector), TIENES YA el detector — úsalo directamente.

EJEMPLO esquina (Cava Baja 42, chaflán):
{
  "dimension":"esquina",
  "detector":{"nombre":"corner-detector","ubicacion":"supabase/functions/_shared/parcel_geometry.ts"},
  "entrada":{"fuente":"polígono catastral de la parcela","regla_usada":"ángulo 60-120° entre 2 fachadas"},
  "causa_raiz":"El edificio hace esquina con chaflán: paño único con orientación intermedia, no hay 2 segmentos con ángulo en rango.",
  "que_cambiar":{"tipo":"regla","detalle":"Promover detección por nº de viales distintos con frente como criterio principal y dejar ángulo como señal secundaria; añadir tipo esquina_chaflan para paño único entre 2 viales.","donde":"parcel_geometry.ts::detectCorner"},
  "override_puntual":{"aplicable":true,"tabla":"building_analysis","campo":"esquina","valor_nuevo":true,"justificacion":"Verificado en Street View: chaflán Cava Baja / Pza Humilladero"},
  "diagnostico":"Detector angular ciego a chaflanes.",
  "campo_actual":"building_analysis.esquina","valor_actual":"false","origen":"heuristica",
  "accion":{"tipo":"override","tabla":"building_analysis","campo":"esquina","valor_nuevo":true}
}`;

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
      score: (ba.data as any)?.score_total,
      cluster: (bldg.data as any)?.cluster_asignado,
      protegido: ba.data?.protegido_historicamente,
      protegido_raw: ba.data?.protegido_raw,
      esquina: ba.data?.esquina,
      escaleras_final: ba.data?.n_escaleras_final,
      escaleras_p01: ba.data?.n_escaleras_en_piso01,
      escaleras_pb: ba.data?.n_escaleras_en_planta_baja,
      escaleras_fuente: ba.data?.n_escaleras_fuente,
      escaleras_subparcelas_dnprc: cat.data?.n_subparcelas_residenciales,
      ventanas_fachada_total: ba.data?.ventanas_fachada_total,
      ventanas_patios_estimadas: ba.data?.ventanas_patios_estimadas,
      patios_detectados: ba.data?.patios_detectados,
      m2_total: cat.data?.m2_total,
      num_viviendas: cat.data?.viviendas_total,
      propietarios_n: owners.data?.length ?? 0,
      modelo_usado: ba.data?.modelo_usado,
      proteccion_source: ba.data?.proteccion_source,
      feedback_metadatos: fb.metadatos ?? null,
      feedback_canal: fb.canal,
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