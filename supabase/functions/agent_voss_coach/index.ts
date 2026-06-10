// agent_voss_coach — consejo táctico Chris Voss (modo brief o post-llamada)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const EMB_URL = 'https://ai.gateway.lovable.dev/v1/embeddings';
const MODEL = 'google/gemini-3-flash-preview';
const EMB_MODEL = 'google/gemini-embedding-001';
const VOSS_SOURCES = ['correo_chris_voss', 'libro_voss'];

const SYSTEM_BRIEF = `Eres el coach Chris Voss de un closer inmobiliario que hace LLAMADAS EN FRÍO a proindivisarios en Madrid. Objetivo de la llamada (NO es vender ni cerrar reunión): (1) que no cuelgue en los primeros 20s, (2) sacar 1 dato de catalogación nuevo, (3) abrir canal (opt-in WhatsApp o identificar influenciador). Personaliza TODO al snapshot: edad/perfil del propietario, % de propiedad (cuota), banderas del edificio (protegido, ITE, conflicto, herencia, baja gestión), cluster. Cita los fragmentos del corpus libro_voss que usaste (chunk_id real, no inventes).

Devuelve SIEMPRE JSON estricto sin markdown, máximo ~200 palabras totales sumando todos los campos string, en español natural listo para leer:
{
  "tecnica_principal": "auditoria_acusaciones+orientacion_al_no",
  "apertura_exacta": "Frase literal lista para leer: gratitud + auditoría de acusaciones personalizada al perfil (edad, cuota %, situación edificio) + pregunta orientada al no. Una sola frase larga o dos cortas, máx ~55 palabras.",
  "etiquetas": [ "Parece que ...", "Da la impresión de que ..." ],
  "preguntas_calibradas": [ "¿Cómo ...?", "¿Qué ...?" ],
  "cierre_micro_compromiso": "Frase literal de opt-in WhatsApp por orientación al no, máx ~30 palabras",
  "objeciones_probables": [
    { "objecion": "...", "respuesta_voss": "frase literal lista para decir" },
    { "objecion": "...", "respuesta_voss": "..." },
    { "objecion": "...", "respuesta_voss": "..." }
  ],
  "por_que": "1 frase: por qué este abordaje encaja con ESTE propietario concreto",
  "fragmentos_usados": [ { "source": "libro_voss", "chunk_id": "<uuid>", "tecnica": "..." } ]
}

Reglas duras:
- Las 2 etiquetas se eligen según el perfil concreto (mayor sin herederos → "ya tiene su vida resuelta"; herencia reciente → "nadie eligió estar ahí"; % bajo → "con esa parte usted no pinta nada"; ITE/derrama → "más disgustos que alegrías"; conflicto → "ponerse de acuerdo no es fácil").
- Las 1–2 preguntas calibradas se eligen según LO QUE FALTE por catalogar (si no sabemos gobernanza → "¿Cómo se organiza el edificio para decisiones?"; si no sabemos motor → "¿Qué tendría que pasar para que esto dejara de ser un problema?"; si no sabemos posición resto → "¿Cómo lo ven los demás propietarios?"). Empiezan SIEMPRE por qué/cómo, nunca por qué causal.
- Las 3 objeciones son las MÁS PROBABLES según el perfil (mayor → "no me interesa", "esto es una estafa"; investor pequeño → "no quiero vender"; profesional → "hable con mi gestor"). Respuesta Voss = etiquetar + reorientar, nunca rebatir.
- Nunca pidas reunión ni hables de precio en esta apertura.
- Si falta dato concreto del snapshot, usa fórmulas neutras ("la situación del edificio") en vez de inventar.`;

const SYSTEM_POST = `Eres el coach Chris Voss analizando una llamada ya ocurrida con un proindivisario. Devuelve JSON estricto sin markdown:
{
  "tecnica_principal": "...",
  "sugerencia": "Qué decir distinto la próxima vez (frase lista)",
  "por_que": "1-2 frases",
  "siguiente_paso": "Acción concreta de seguimiento (WhatsApp, recontacto, info que falta)",
  "fragmentos_usados": [ { "source": "libro_voss", "chunk_id": "<uuid>", "tecnica": "..." } ]
}`;

async function embed(text: string, key: string): Promise<number[] | null> {
  try {
    const r = await fetch(EMB_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMB_MODEL, input: text }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const v = j?.data?.[0]?.embedding;
    if (!Array.isArray(v)) return null;
    // DB column is vector(768); truncate if gateway returns 3072
    return (v.length > 768 ? v.slice(0, 768) : v) as number[];
  } catch { return null; }
}

async function callAI(messages: any[], key: string): Promise<any> {
  const r = await fetch(AI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, response_format: { type: 'json_object' } }),
  });
  if (!r.ok) throw new Error(`ai ${r.status}: ${(await r.text()).slice(0,200)}`);
  const j = await r.json();
  try { return JSON.parse(j?.choices?.[0]?.message?.content ?? '{}'); }
  catch { return { raw: j?.choices?.[0]?.message?.content }; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { mode = 'brief', owner_id, building_id, call_transcript, focus } = await req.json();
    const lk = Deno.env.get('LOVABLE_API_KEY');
    if (!lk) throw new Error('LOVABLE_API_KEY missing');
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Snapshot
    let snapshot: any = {};
    if (owner_id) {
      const { data: o } = await sb.from('owners').select('nombre, rol, tipologia, telefono, metadatos').eq('id', owner_id).maybeSingle();
      snapshot.propietario = o;
    }
    if (building_id) {
      const [{ data: bldg }, { data: ba }, { data: bo }] = await Promise.all([
        sb.from('buildings').select('direccion, metadatos').eq('id', building_id).maybeSingle(),
        sb.from('building_analysis').select('score_total, cluster_label, banderas, protegido, num_viviendas, m2_total').eq('building_id', building_id).maybeSingle(),
        owner_id ? sb.from('building_owners').select('cuota, subrole').eq('building_id', building_id).eq('owner_id', owner_id).maybeSingle() : Promise.resolve({ data: null }) as any,
      ]);
      snapshot.edificio = bldg;
      snapshot.analisis = ba;
      snapshot.relacion = bo;
    }

    // RAG
    const query = focus || `Llamada en frío a propietario ${snapshot.propietario?.nombre ?? ''} sobre edificio ${snapshot.edificio?.direccion ?? ''}. Cluster ${snapshot.analisis?.cluster_label ?? ''}. ${mode === 'post' ? 'Análisis post-llamada.' : 'Brief pre-llamada: cómo abrir y qué evitar.'}`;
    const vec = await embed(query, lk);
    let fragments: any[] = [];
    if (vec) {
      try {
        const { data: hits } = await (sb.rpc as any)('match_knowledge_chunks', { query_embedding: vec, match_count: 6, filter_origenes: VOSS_SOURCES });
        fragments = hits || [];
      } catch {
        // fallback: no RPC, intentamos selección directa por origen
        const { data: kc } = await sb.from('knowledge_chunks').select('id, origen, contenido').in('origen', VOSS_SOURCES).limit(6);
        fragments = (kc || []).map((k: any) => ({ chunk_id: k.id, source: k.origen, snippet: (k.contenido || '').slice(0, 400) }));
      }
    }
    if (!fragments.length) {
      const { data: kc } = await sb.from('knowledge_chunks').select('id, origen, contenido').in('origen', VOSS_SOURCES).limit(6);
      fragments = (kc || []).map((k: any) => ({ chunk_id: k.id, source: k.origen, snippet: (k.contenido || '').slice(0, 400) }));
    }

    const userMsg = `MODO: ${mode}
SNAPSHOT:
${JSON.stringify(snapshot, null, 2)}

${call_transcript ? `TRANSCRIPCIÓN:\n${call_transcript}\n` : ''}
FRAGMENTOS VOSS DISPONIBLES (referencia obligatoria si no están vacíos):
${fragments.length ? fragments.map((f: any, i: number) => `[${i+1}] (${f.source}) ${f.snippet}`).join('\n\n') : '(no hay fragmentos indexados todavía — basa la sugerencia en los principios generales Voss)'}

Devuelve el JSON estricto.`;

    const sys = mode === 'post' ? SYSTEM_POST : SYSTEM_BRIEF;
    const ai = await callAI([
      { role: 'system', content: sys },
      { role: 'user', content: userMsg },
    ], lk);

    // Asegurar fragmentos_usados pobladas
    if (!Array.isArray(ai.fragmentos_usados) || ai.fragmentos_usados.length === 0) {
      ai.fragmentos_usados = fragments.slice(0, 2);
    }

    return new Response(JSON.stringify({ ok: true, voss: ai, fragments_count: fragments.length }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});