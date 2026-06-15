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

const PROMPT = `Eres analista de coach comercial inmobiliario en España. Recibes la TRANSCRIPCIÓN o NOTA POST-LLAMADA de una llamada del comercial al propietario. Tu tarea es decir QUÉ DATOS DEL SCORING consiguió el comercial DURANTE la llamada y CITAR LA FRASE LITERAL que lo prueba. NO inventes. Si un dato no se consiguió, marca conseguido=false y deja frase_prueba en cadena vacía.

Devuelve EXCLUSIVAMENTE este JSON:
{
  "tipologia":      {"conseguido": true|false, "valor": "string libre o ''", "frase_prueba": "cita literal o ''"},
  "que_le_mueve":   {"conseguido": true|false, "valor": "motivación detectada o ''", "frase_prueba": "cita literal o ''"},
  "info_edificio":  {"conseguido": true|false, "valor": "dato concreto del edificio o ''", "frase_prueba": "cita literal o ''"},
  "canal_abierto":  {"conseguido": true|false, "valor": "whatsapp|email|cita|callback|otro|''", "frase_prueba": "cita literal o ''"},
  "score_post_call": 0,
  "resumen": "1-2 frases neutras del resultado de la llamada"
}

REGLAS:
- "frase_prueba" SIEMPRE cita literal extraída del texto (puede ser del comercial o del cliente). Si no hay, ''.
- score_post_call = nº de datos conseguidos × 25 (0,25,50,75,100).
- Si la llamada está sin contestación o el agente fue bloqueado por filtro, todos los datos van conseguido=false, score=0.
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

  // Candidatas: con transcripción y sin post_call_scoring
  const { data: pend, error } = await sb
    .from("calls")
    .select("id, comercial_email, duracion_seg, transcripcion, metadatos")
    .not("transcripcion", "is", null)
    .neq("transcripcion", "")
    .order("fecha", { ascending: false })
    .limit(200);
  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });

  const queue = (pend ?? []).filter((c: any) => !(c.metadatos && c.metadatos.post_call_scoring));
  const batch = queue.slice(0, BATCH);
  const remaining = Math.max(queue.length - BATCH, 0);

  const results: any[] = [];
  for (const c of batch as any[]) {
    if (Date.now() - t0 > MAX_MS) break;
    const bucket = durationBucket(c.duracion_seg);
    try {
      const scoring = (c.transcripcion?.length ?? 0) < 50
        ? { tipologia:{conseguido:false,valor:"",frase_prueba:""}, que_le_mueve:{conseguido:false,valor:"",frase_prueba:""}, info_edificio:{conseguido:false,valor:"",frase_prueba:""}, canal_abierto:{conseguido:false,valor:"",frase_prueba:""}, score_post_call: 0, resumen: "Sin transcripción suficiente." }
        : await scoreCall(c.transcripcion);
      const meta = { ...(c.metadatos ?? {}), post_call_scoring: scoring, duration_bucket: bucket, scored_at: new Date().toISOString(), scored_model: MODEL };
      await sb.from("calls").update({ metadatos: meta }).eq("id", c.id);
      results.push({ id: c.id, bucket, score: scoring.score_post_call ?? null });
    } catch (e: any) {
      const meta = { ...(c.metadatos ?? {}), post_call_scoring_error: String(e?.message ?? e), duration_bucket: bucket, scored_at: new Date().toISOString() };
      await sb.from("calls").update({ metadatos: meta }).eq("id", c.id);
      results.push({ id: c.id, bucket, error: String(e?.message ?? e) });
    }
  }

  if (remaining > 0 || queue.length > batch.length) {
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