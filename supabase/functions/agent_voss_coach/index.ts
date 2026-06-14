// agent_voss_coach v2 — Experto Chris Voss en llamada en frío a proindivisarios.
// Dos modos:
//   brief: PLAN DE LLAMADA personalizado con datos reales + histórico de calls.
//   post:  EVALUACIÓN de transcripción contra checklist mínimo de catalogación.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const AI_URL = 'https://ai.gateway.lovable.dev/v1/chat/completions';
const EMB_URL = 'https://ai.gateway.lovable.dev/v1/embeddings';
const MODEL = 'google/gemini-2.5-flash';
const EMB_MODEL = 'google/gemini-embedding-001';
const VOSS_SOURCES = ['correo_chris_voss', 'libro_voss', 'tipologias_qa', 'metodo_cold_call'];

const SYSTEM_BRIEF = `Eres un EXPERTO Chris Voss especializado en LLAMADA EN FRÍO a proindivisarios de edificios de Madrid (herencias, copropiedad fragmentada, conflictos, mala gestión). NO eres un coach genérico de manual: produces un PLAN DE LLAMADA literal, accionable y referido a los DATOS REALES del SNAPSHOT.

OBJETIVOS de la llamada (en orden, no negociables):
 1) Que no cuelgue en los primeros 20 segundos.
 2) Sacar la INFO MÍNIMA DE CATALOGACIÓN: tipología del propietario (T1..T10 o buyer_persona), qué le MUEVE (motor real), info del edificio (estado, copropietarios, alquileres, conflictos), abrir CANAL (WhatsApp opt-in o identificar un influenciador interno).
 3) Si hay HISTÓRICO de llamadas previas: RETOMAR desde donde se dejó; nunca arrancar de cero.

APERTURA obligatoria: gratitud breve + transparencia del origen del teléfono (Registro de la Propiedad / nota simple) + auditoría de acusaciones PERSONALIZADA al perfil real (edad, cuota %, situación del edificio) + pregunta orientada al NO. Nunca pedir reunión ni hablar de precio en la apertura.

Etiquetas Voss reales según perfil (no inventar):
  mayor sin herederos → "Parece que ya tiene su vida resuelta y esto es ruido."
  herencia reciente → "Da la impresión de que nadie eligió estar en esto."
  cuota baja (<10%) → "Parece que con esa parte usted no pinta gran cosa en las decisiones."
  ITE/derrama/mala gestión → "Da la impresión de que el edificio le da más disgustos que alegrías."
  conflicto/proindiviso bloqueado → "Parece que ponerse de acuerdo entre todos no es fácil."
  inversor pequeño → "Parece que esto era para rentar tranquilo, no para complicarse."
  profesional/operador → "Da la impresión de que prefiere que esto lo lleven otros."

Preguntas calibradas según LO QUE FALTE en el snapshot:
  sin tipología → "¿Cómo llegó usted a tener esta parte del edificio?"
  sin motor → "¿Qué tendría que pasar para que esto dejara de ser un tema?"
  sin info gobernanza → "¿Cómo se organizan ustedes para tomar decisiones?"
  sin posición resto → "¿Cómo lo viven los demás copropietarios?"
  sin alquileres → "¿Cómo está hoy el edificio, vacío, alquilado, alguno cerrado?"
Siempre empiezan por qué/cómo, nunca "por qué" causal.

Devuelve SIEMPRE JSON ESTRICTO sin markdown con esta forma EXACTA:
{
  "modo": "brief",
  "contexto_propietario": {
    "quien_es": "1-2 frases con nombre, tipología/buyer_persona, % cuota, subrole, edad/zona si consta",
    "situacion_edificio": "1-2 frases con dirección, banderas reales (proindiviso, ITE, conflicto, mala_gestion_score, protegido, cluster)",
    "datos_faltantes": ["lista de campos clave que NO tenemos y hay que sacar en la llamada"]
  },
  "historico": {
    "tiene_historico": true,
    "resumen": "Qué se habló, qué dijo el propietario, dónde se quedó, objeciones puestas. Si no hay, di 'Primer contacto en frío'.",
    "punto_de_retoma": "Frase concreta: 'Retomar desde X' o 'Apertura de primer contacto'"
  },
  "guion": {
    "apertura_exacta": "Frase LITERAL lista para leer. Incluye: gratitud + 'su número aparece en el Registro de la Propiedad como copropietario de <dirección>' + auditoría de acusaciones personalizada + pregunta orientada al no. Máx 70 palabras.",
    "etiquetas": ["dos etiquetas Voss literales elegidas según el perfil real"],
    "preguntas_calibradas": ["1-2 preguntas literales para sacar el dato que falta"],
    "objeciones_probables": [
      {"objecion": "objeción literal típica de ESTE perfil", "respuesta_voss": "frase literal: etiquetar + reorientar, no rebatir", "tecnica": "p.ej. espejo, etiqueta, orientación al no"},
      {"objecion": "...", "respuesta_voss": "...", "tecnica": "..."},
      {"objecion": "...", "respuesta_voss": "...", "tecnica": "..."}
    ],
    "cierre_micro_compromiso": "Frase literal de opt-in WhatsApp orientada al no. Máx 35 palabras. Ej: '¿Sería una locura que le mandara por WhatsApp un resumen de 3 líneas para que lo vea cuando le venga bien?'"
  },
  "info_minima_a_extraer": {
    "tipologia": "qué hay que confirmar/descubrir sobre su tipología",
    "que_le_mueve": "qué motor identificar (dinero, paz, herederos, miedo, control)",
    "info_edificio": ["lista de datos del edificio/copropietarios/alquileres a sacar"],
    "canal_abierto": "qué resultado mínimo cuenta como canal abierto (whatsapp, mail, referido a influenciador)"
  },
  "por_que_funciona": "1-2 frases explicando por qué este abordaje encaja con ESTE propietario concreto, citando el dato del snapshot que lo justifica",
  "fragmentos_usados": [{"source": "libro_voss|correo_chris_voss", "chunk_id": "<uuid real>", "tecnica": "..."}]
}

Si un dato falta en el snapshot, decláralo en datos_faltantes y usa fórmula neutra ("la situación del edificio") en el guion. NO inventes nombres, cuotas, ni hechos.`;

const SYSTEM_POST = `Eres un EXPERTO Chris Voss EVALUANDO una llamada en frío YA OCURRIDA con un proindivisario. Tu trabajo: medir cuán efectivo fue el comercial contra el CHECKLIST MÍNIMO DE CATALOGACIÓN y dar feedback concreto citando momentos LITERALES de la transcripción.

CHECKLIST mínimo (boolean cada uno, justificado con cita):
  tipologia_capturada — ¿quedó clara la tipología/buyer_persona del propietario?
  motor_capturado — ¿quedó claro qué le mueve?
  info_edificio_capturada — ¿se obtuvo info nueva del edificio, copropietarios o alquileres?
  canal_abierto — ¿hay opt-in WhatsApp/mail o referido a influenciador?

Devuelve SIEMPRE JSON ESTRICTO sin markdown:
{
  "modo": "post",
  "checklist": {
    "tipologia_capturada": {"ok": false, "evidencia": "cita literal de la transcripción o 'no se intentó'"},
    "motor_capturado": {"ok": false, "evidencia": "..."},
    "info_edificio_capturada": {"ok": false, "evidencia": "..."},
    "canal_abierto": {"ok": false, "evidencia": "..."}
  },
  "puntuacion": {
    "score_0_100": 0,
    "justificacion": "2-3 frases explicando el score citando momentos concretos"
  },
  "que_hizo_bien": [{"momento": "cita literal", "tecnica_voss": "etiqueta|espejo|orientación al no|auditoría|pregunta calibrada", "comentario": "por qué funcionó"}],
  "momentos_flojos": [{"momento": "cita literal", "que_paso": "...", "mejora_voss": "frase LITERAL alternativa que el comercial debería haber dicho", "tecnica": "..."}],
  "proxima_accion": "Acción concreta y plazo (p.ej. 'WhatsApp en 48h con resumen 3 líneas')",
  "sacar_en_siguiente_contacto": ["lista de datos del checklist que quedaron pendientes"],
  "fragmentos_usados": [{"source": "libro_voss|correo_chris_voss", "chunk_id": "<uuid real>", "tecnica": "..."}]
}

Reglas: NO inventes citas. Si la transcripción no contiene evidencia, di 'no se intentó' o 'sin evidencia en la transcripción'. NO uses frases de manual genéricas: cada mejora_voss debe estar adaptada al momento concreto de la llamada y al perfil del propietario del snapshot.`;

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
    return (v.length > 768 ? v.slice(0, 768) : v) as number[];
  } catch { return null; }
}

async function callAI(messages: any[], key: string): Promise<any> {
  const r = await fetch(AI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, response_format: { type: 'json_object' } }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`ai ${r.status}: ${t.slice(0, 300)}`);
  }
  const j = await r.json();
  const txt = j?.choices?.[0]?.message?.content ?? '{}';
  try { return JSON.parse(txt); } catch { return { raw: txt }; }
}

function shortCall(c: any) {
  return {
    fecha: c.fecha,
    outcome: c.outcome,
    sentiment: c.sentiment,
    duracion_seg: c.duracion_seg,
    resumen: c.resumen,
    objeciones: c.objeciones,
    siguiente_accion: c.siguiente_accion,
    notas_post_llamada: c.notas_post_llamada,
    transcripcion: c.transcripcion ? String(c.transcripcion).slice(0, 4000) : null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const { mode = 'brief', owner_id, building_id, call_transcript } = await req.json();
    const lk = Deno.env.get('LOVABLE_API_KEY');
    if (!lk) throw new Error('LOVABLE_API_KEY missing');
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // 1) Snapshot real
    const snapshot: any = { datos_faltantes: [] as string[] };

    if (owner_id) {
      const { data: o } = await sb.from('owners')
        .select('id, nombre, rol, subrole, buyer_persona, telefono, consentimiento, notas_breves, metadatos')
        .eq('id', owner_id).maybeSingle();
      snapshot.propietario = o;
      if (!o?.buyer_persona || o.buyer_persona === 'sin_clasificar') snapshot.datos_faltantes.push('buyer_persona/tipologia');
      if (!o?.telefono) snapshot.datos_faltantes.push('telefono');
      if (!o?.consentimiento) snapshot.datos_faltantes.push('consentimiento_whatsapp');
    } else {
      snapshot.datos_faltantes.push('owner_id no provisto');
    }

    if (building_id) {
      const [{ data: bldg }, { data: ba }, { data: rel }, { data: copros }] = await Promise.all([
        sb.from('buildings').select('id, direccion, metadatos').eq('id', building_id).maybeSingle(),
        sb.from('building_analysis').select('protegido_historicamente, mala_gestion_score, mala_gestion_evidencias, edificio_reformado, gestion_profesional, n_escaleras_final, ventanas_fachada_total, plantas_visibles, esquina').eq('building_id', building_id).maybeSingle(),
        owner_id ? sb.from('building_owners').select('cuota, subrole, es_influencer, influencer_reason, rol_notas').eq('building_id', building_id).eq('owner_id', owner_id).maybeSingle() : Promise.resolve({ data: null }) as any,
        sb.from('building_owners').select('cuota, subrole, owner_id, owners(nombre)').eq('building_id', building_id).order('cuota', { ascending: false, nullsFirst: false }).limit(15),
      ]);
      snapshot.edificio = bldg;
      snapshot.analisis = ba;
      snapshot.relacion_propietario_edificio = rel;
      snapshot.copropietarios_top = (copros || []).map((c: any) => ({ nombre: c.owners?.nombre, cuota: c.cuota, subrole: c.subrole, es_yo: c.owner_id === owner_id }));
      if (!rel?.cuota) snapshot.datos_faltantes.push('cuota_propiedad');
      if (ba?.mala_gestion_score == null) snapshot.datos_faltantes.push('mala_gestion_score');
    }

    // 2) Histórico de llamadas (solo en brief; en post viene la transcripción)
    let historico: any[] = [];
    if (owner_id) {
      const { data: cs } = await sb.from('calls')
        .select('id, fecha, outcome, sentiment, duracion_seg, resumen, objeciones, siguiente_accion, notas_post_llamada, transcripcion')
        .eq('owner_id', owner_id).order('fecha', { ascending: false }).limit(5);
      historico = (cs || []).map(shortCall);
    }

    // 3) RAG Voss
    const focusText = mode === 'post'
      ? `Evaluación post-llamada proindivisario. Perfil: ${snapshot.propietario?.buyer_persona || 'sin_clasificar'} ${snapshot.relacion_propietario_edificio?.subrole || ''}. Edificio: ${snapshot.edificio?.direccion || ''}.`
      : `Llamada en frío proindivisario. Perfil: ${snapshot.propietario?.buyer_persona || 'sin_clasificar'} cuota ${snapshot.relacion_propietario_edificio?.cuota || '?'}%. Edificio: ${snapshot.edificio?.direccion || ''} mala_gestion=${snapshot.analisis?.mala_gestion_score ?? '?'}. ${historico.length ? 'Retomar histórico previo.' : 'Primer contacto.'}`;
    const vec = await embed(focusText, lk);
    let fragments: any[] = [];
    if (vec) {
      try {
        const { data: hits } = await (sb.rpc as any)('match_knowledge_chunks', {
          query_embedding: vec, match_count: 6, filter_origenes: VOSS_SOURCES,
          filter_scope_type: null, filter_scope_id: null,
        });
        fragments = (hits || []).map((h: any) => ({
          chunk_id: h.id || h.chunk_id, source: h.origen || h.source, snippet: (h.contenido || h.snippet || '').slice(0, 500),
        }));
      } catch (_) { /* fallback below */ }
    }
    if (!fragments.length) {
      const { data: kc } = await sb.from('knowledge_chunks').select('id, origen, contenido').in('origen', VOSS_SOURCES).limit(6);
      fragments = (kc || []).map((k: any) => ({ chunk_id: k.id, source: k.origen, snippet: (k.contenido || '').slice(0, 500) }));
    }

    // 3.bis) Tácticas ganadoras del playbook (sistema que aprende)
    const perfilKey = snapshot.propietario?.buyer_persona || 'sin_clasificar';
    const { data: pbRows } = await sb
      .from('call_playbook')
      .select('tactica_tipo, tactica_texto, ejemplo_literal, n_usos, n_exito, tasa_exito')
      .in('perfil_tipologia', [perfilKey, 'sin_clasificar'])
      .gte('n_usos', 1)
      .order('tasa_exito', { ascending: false })
      .order('n_usos', { ascending: false })
      .limit(8);
    const playbook = pbRows || [];

    // 4) Payload al modelo
    const userMsg = `MODO: ${mode}

SNAPSHOT REAL (no inventes lo que no esté aquí):
${JSON.stringify(snapshot, null, 2)}

HISTÓRICO DE LLAMADAS (${historico.length} previas):
${historico.length ? JSON.stringify(historico, null, 2) : '(sin histórico — PRIMER CONTACTO en frío)'}

${mode === 'post' ? `TRANSCRIPCIÓN A EVALUAR:\n${call_transcript || '(sin transcripción provista)'}\n` : ''}
PLAYBOOK MEDIDO (tácticas con mejor tasa_exito para este perfil — PRIORÍZALAS y cítalas en por_que_funciona):
${playbook.length ? playbook.map((p: any, i: number) => `[${i+1}] tipo=${p.tactica_tipo} texto="${p.tactica_texto}" tasa=${p.tasa_exito} (n=${p.n_usos}/${p.n_exito})${p.ejemplo_literal ? ` ej: "${p.ejemplo_literal}"` : ''}`).join('\n') : '(playbook vacío — primera iteración, usa criterio Voss/Sandler)'}

FRAGMENTOS VOSS (cita chunk_id real en fragmentos_usados):
${fragments.map((f, i) => `[${i+1}] (${f.source}) chunk_id=${f.chunk_id}\n${f.snippet}`).join('\n\n')}

Devuelve el JSON estricto con la forma EXACTA del system.`;

    const sys = mode === 'post' ? SYSTEM_POST : SYSTEM_BRIEF;
    const ai = await callAI([
      { role: 'system', content: sys },
      { role: 'user', content: userMsg },
    ], lk);

    if (!Array.isArray(ai.fragmentos_usados) || ai.fragmentos_usados.length === 0) {
      ai.fragmentos_usados = fragments.slice(0, 2).map((f) => ({ source: f.source, chunk_id: f.chunk_id, tecnica: 'corpus_voss' }));
    }
    if (mode === 'brief') {
      ai.playbook_priorizado = playbook.slice(0, 3).map((p: any) => ({
        tipo: p.tactica_tipo, tactica: p.tactica_texto, tasa_exito: p.tasa_exito, n_usos: p.n_usos,
      }));
    }

    return new Response(JSON.stringify({
      ok: true,
      mode,
      voss: ai,
      meta: {
        historico_count: historico.length,
        fragments_count: fragments.length,
        playbook_count: playbook.length,
        datos_faltantes: snapshot.datos_faltantes,
        snapshot_keys: Object.keys(snapshot),
      },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});