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

const SYSTEM = `Eres un coach de negociación basado en Chris Voss (Never Split the Difference). Trabajas para un closer inmobiliario que llama a propietarios de Madrid para captar edificios. Recomienda UNA técnica concreta (mirroring, labeling, calibrated questions, accusation audit, "that's right", "no", anchoring, bending reality) y una frase exacta lista para decir en español neutro y natural. Cita los fragmentos del corpus que usaste.

Devuelve SIEMPRE JSON estricto sin markdown:
{
  "tecnica_principal": "...",
  "sugerencia": "Frase exacta que el comercial puede decir",
  "por_que": "Razonamiento en una o dos frases",
  "siguiente_paso": "Acción concreta tras la frase",
  "fragmentos_usados": [ { "source": "...", "chunk_id": "...", "snippet": "..." } ]
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
    return j?.data?.[0]?.embedding ?? null;
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

    const ai = await callAI([
      { role: 'system', content: SYSTEM },
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