import { createClient } from "jsr:@supabase/supabase-js@2";
import { embed } from "../_shared/embed.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `Eres el coach IA de AFFLUX, copiloto comercial inmobiliario.
Respondes preguntas del equipo sobre llamadas, notas y conversaciones del CRM.
Usa SOLO el contexto recuperado. Si no hay evidencia suficiente, dilo claramente.
Cita siempre las fuentes con la notación [n] al final de cada afirmación, donde n es el índice de la fuente.
Responde en español, claro y conciso, en Markdown.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { question, scope_type, scope_id, origen, match_count } = await req.json();
    if (!question || typeof question !== "string") {
      return new Response(JSON.stringify({ error: "question requerida" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY no configurada");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Embed question
    const qv = await embed(question);

    // 2. Hybrid retrieval
    const { data: hits, error: hitsErr } = await supabase.rpc("rpc_rag_search", {
      query_text: question,
      query_embedding: qv as unknown as string ?? null,
      match_count: Math.min(Number(match_count ?? 8), 20),
      filter_scope_type: scope_type ?? null,
      filter_scope_id: scope_id ?? null,
      filter_origen: origen ?? null,
    });
    if (hitsErr) console.error("rpc_rag_search error", hitsErr);

    const sources = (hits ?? []).map((h: any, i: number) => ({
      idx: i + 1,
      id: h.id,
      origen: h.origen,
      referencia_id: h.referencia_id,
      scope_type: h.scope_type,
      scope_id: h.scope_id,
      similarity: h.similarity,
      hybrid_score: h.hybrid_score,
      contenido: h.contenido,
      metadatos: h.metadatos,
    }));

    if (sources.length === 0) {
      return new Response(JSON.stringify({
        answer: "No encuentro información relevante en el conocimiento indexado para responder esta pregunta.",
        sources: [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const context = sources.map((s) =>
      `[${s.idx}] (${s.origen}) ${s.contenido}`
    ).join("\n\n---\n\n");

    // 3. Ask Gemini
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Pregunta: ${question}\n\nContexto recuperado:\n${context}` },
        ],
      }),
    });
    if (!aiRes.ok) {
      if (aiRes.status === 429) {
        return new Response(JSON.stringify({ error: "Límite alcanzado, prueba en unos minutos." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiRes.status === 402) {
        return new Response(JSON.stringify({ error: "Sin créditos disponibles." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await aiRes.text();
      throw new Error(`AI gateway ${aiRes.status}: ${t}`);
    }
    const aiJson = await aiRes.json();
    const answer = aiJson?.choices?.[0]?.message?.content ?? "";

    return new Response(JSON.stringify({ answer, sources }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("coach_ask error", e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});