// Orquestador: aplica el "Modo 2" (post-llamada del coach) sobre todas las
// llamadas con transcripción que aún no tengan calls.metadatos.post_call_scoring.
// Extrae 4 datos del scoring con frase literal que lo prueba:
//   - tipologia (qué tipo de propietario / propiedad es)
//   - que_le_mueve (motivación, dolor, objetivo)
//   - info_edificio (datos concretos del edificio)
//   - canal_abierto (whatsapp / email / cita / opt-in conseguido)
// Además clasifica por DURACIÓN: <30s, 30-60s, 60-90s, >90s.
// Lotes de 5, self-reinvoke. Al vaciar la cola dispara learn_from_calls.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const BATCH = 5;
const MAX_MS = 110_000;
const MODEL = "google/gemini-2.5-flash";

function durationBucket(sec: number | null | undefined): string {
  const s = Number(sec ?? 0);
  if (!s || s <= 0) return "desconocida";
  if (s < 30) return "lt_30";
  if (s < 60) return "30_60";
  if (s < 90) return "60_90";
  return "gt_90";
}

const PROMPT = `Eres analista de coach comercial inmobiliario en España. Recibes la TRANSCRIPCIÓN o NOTA POST-LLAMADA de una llamada del comercial al propietario. Tu única tarea es decir QUÉ HITOS DEL CHECKLIST consiguió el comercial y CITAR LA FRASE LITERAL que lo prueba. NO inventes. Si un hito no se consiguió, conseguido=false y frase_prueba=''.

El SCORE de la llamada depende EXCLUSIVAMENTE de los hitos conseguidos. La duración de la llamada NO se evalúa aquí: es un dato diagnóstico aparte y NO debe influir en tu juicio.

HITOS (4):
1) tipologia: el comercial averigua qué tipo de propietario/propiedad es (particular, family office, fondo, herederos, inversor, gestor, etc.).
2) que_le_mueve: motivación, dolor u objetivo del propietario (vender ya, rentabilizar, problemas con inquilinos, herencia, jubilación, reforma, etc.).
3) info_edificio: cualquier dato concreto del edificio o su explotación: nº de copropietarios, plantas, viviendas, locales, alquileres vigentes, rentas, antigüedad, estado, derramas, intención de venta del bloque, etc.
4) canal_abierto: el comercial obtiene un canal de seguimiento real (whatsapp confirmado, email, cita agendada, callback en fecha concreta, envío de info aceptado).

Devuelve EXCLUSIVAMENTE este JSON:
{
  "tipologia":      {"conseguido": true|false, "valor": "string libre o ''", "frase_prueba": "cita literal o ''"},
  "que_le_mueve":   {"conseguido": true|false, "valor": "motivación detectada o ''", "frase_prueba": "cita literal o ''"},
  "info_edificio":  {"conseguido": true|false, "valor": "dato concreto o ''", "frase_prueba": "cita literal o ''", "sub":{"copropietarios": true|false, "alquileres": true|false, "otros": true|false}},
  "canal_abierto":  {"conseguido": true|false, "valor": "whatsapp|email|cita|callback|otro|''", "frase_prueba": "cita literal o ''"},
  "hits_total": 0,
  "score_post_call": 0,
  "resumen": "1-2 frases neutras del resultado de la llamada"
}

REGLAS:
- "frase_prueba" SIEMPRE cita literal extraída del texto. Si no hay, ''.
- hits_total = nº de hitos con conseguido=true (0..4).
- score_post_call = hits_total * 25 (0,25,50,75,100). Sin penalizaciones por duración.
- Si la llamada está sin contestación, contestador o bloqueada por filtro: todos los hitos false, hits_total=0, score=0.
- No añadas campos. No incluyas texto fuera del JSON.`;

async function scoreCall(tx: string): Promise<any> {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: tx.slice(0, 12000) },
      ],
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`ai_${r.status}: ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  const content = j?.choices?.[0]?.message?.content ?? "{}";
  try { return JSON.parse(content); } catch { return { _raw: content.slice(0, 500) }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const t0 = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // Pendientes reales filtrando en BBDD (NOT metadatos ? 'post_call_scoring').
  const { data: pend, error } = await sb.rpc("get_pending_scoring_calls", { _limit: BATCH });
  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  const batch = (pend ?? []) as any[];
  const { data: totalPend } = await sb.rpc("count_pending_scoring_calls");
  const totalPending = Number(totalPend ?? 0);
  const remaining = Math.max(totalPending - batch.length, 0);

  const results: any[] = [];
  for (const c of batch as any[]) {
    if (Date.now() - t0 > MAX_MS) break;
    const bucket = durationBucket(c.duracion_seg);
    try {
      const scoring = (c.transcripcion?.length ?? 0) < 50
        ? { tipologia:{conseguido:false,valor:"",frase_prueba:""}, que_le_mueve:{conseguido:false,valor:"",frase_prueba:""}, info_edificio:{conseguido:false,valor:"",frase_prueba:"",sub:{copropietarios:false,alquileres:false,otros:false}}, canal_abierto:{conseguido:false,valor:"",frase_prueba:""}, hits_total:0, score_post_call: 0, resumen: "Sin transcripción suficiente." }
        : await scoreCall(c.transcripcion);
      // Recompute hits_total / score_post_call defensively from booleans
      const hits = [scoring?.tipologia?.conseguido, scoring?.que_le_mueve?.conseguido, scoring?.info_edificio?.conseguido, scoring?.canal_abierto?.conseguido].filter(Boolean).length;
      scoring.hits_total = hits;
      scoring.score_post_call = hits * 25;
      const meta = { ...(c.metadatos ?? {}), post_call_scoring: scoring, duration_bucket: bucket, scored_at: new Date().toISOString(), scored_model: MODEL };
      await sb.from("calls").update({ metadatos: meta }).eq("id", c.id);
      results.push({ id: c.id, bucket, score: scoring.score_post_call ?? null });
    } catch (e: any) {
      const meta = { ...(c.metadatos ?? {}), post_call_scoring_error: String(e?.message ?? e), duration_bucket: bucket, scored_at: new Date().toISOString() };
      await sb.from("calls").update({ metadatos: meta }).eq("id", c.id);
      results.push({ id: c.id, bucket, error: String(e?.message ?? e) });
    }
  }

  if (remaining > 0) {
    fetch(`${SUPABASE_URL}/functions/v1/score-calls-historical`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: "{}",
    }).catch(() => {});
  } else {
    // Cola vacía → alimentar playbook
    fetch(`${SUPABASE_URL}/functions/v1/learn_from_calls`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: "{}",
    }).catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true, processed: batch.length, queue_remaining: remaining, results }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});