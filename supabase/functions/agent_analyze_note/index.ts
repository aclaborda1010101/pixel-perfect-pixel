import { createClient } from "jsr:@supabase/supabase-js@2";
import { embed } from "../_shared/embed.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MODEL = "google/gemini-3-flash-preview";

// HITL trigger keywords (tipo "muerte", "herencia", etc.)
const HITL_KEYWORDS = [
  "fallec", "muert", "defunci", "herenci", "testament", "tutela", "incapacita",
  "death", "deceas", "inherit", "estate", "guardiansh",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const t0 = Date.now();
  try {
    const { owner_id, texto, locale = "es" } = await req.json();
    if (!texto) {
      return new Response(JSON.stringify({ error: "texto required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const sys = locale === "en"
      ? "You analyze real-estate call notes/transcripts. Extract facts, intents, sentiment, propose a single concrete next action, and flag if human review is required (e.g., bereavement, inheritance, vulnerable customer)."
      : "Analizas notas/transcripciones de llamadas inmobiliarias. Extrae hechos, intenciones, sentimiento, propón UNA próxima acción concreta y marca si requiere revisión humana (p. ej. fallecimiento, herencia, cliente vulnerable).";

    const tools = [{
      type: "function",
      function: {
        name: "analyze",
        parameters: {
          type: "object",
          properties: {
            hechos: { type: "array", items: { type: "string" } },
            intenciones: { type: "array", items: { type: "string" } },
            sentimiento: { type: "string", enum: ["positivo", "neutro", "negativo", "positive", "neutral", "negative"] },
            proxima_accion: {
              type: "object",
              properties: {
                titulo: { type: "string" },
                detalle: { type: "string" },
                vencimiento_dias: { type: "number" },
              },
              required: ["titulo"],
              additionalProperties: false,
            },
            hitl_required: { type: "boolean" },
            motivo_hitl: { type: "string" },
            confianza: { type: "number" },
          },
          required: ["hechos", "intenciones", "sentimiento", "proxima_accion", "hitl_required", "confianza"],
          additionalProperties: false,
        },
      },
    }];

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: texto },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "analyze" } },
      }),
    });

    if (!aiRes.ok) {
      const txt = await aiRes.text();
      throw new Error(`AI error ${aiRes.status}: ${txt}`);
    }
    const aiJson = await aiRes.json();
    const call = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    const analysis = JSON.parse(call?.function?.arguments ?? "{}");
    const usage = aiJson?.usage ?? {};

    // Refuerzo determinista: si keywords sensibles aparecen, forzamos HITL
    const lower = texto.toLowerCase();
    const matched = HITL_KEYWORDS.find((kw) => lower.includes(kw));
    if (matched && !analysis.hitl_required) {
      analysis.hitl_required = true;
      analysis.motivo_hitl = (analysis.motivo_hitl ?? "") +
        ` Detector keyword: "${matched}".`;
    }

    // Persistir nota original y crear caso de compliance si HITL
    if (owner_id) {
      const { data: noteRow } = await supabase.from("notes").insert({
        owner_id, texto, etiquetas: ["agent_analyze_note"],
      }).select("id").maybeSingle();

      // RAG ingest (best-effort)
      try {
        const v = await embed(texto);
        await supabase.from("knowledge_chunks").insert({
          contenido: texto,
          origen: "nota",
          referencia_id: noteRow?.id ?? null,
          scope_type: "owner",
          scope_id: owner_id,
          metadatos: { source: "agent_analyze_note" },
          embedding: v as unknown as string ?? null,
        });
      } catch (e) { console.warn("rag ingest failed", e); }
    }
    if (analysis.hitl_required) {
      await supabase.from("compliance_cases").insert({
        scope_type: "owner",
        scope_id: owner_id ?? null,
        motivo: analysis.motivo_hitl ?? "Revisión humana requerida",
        evidencia: texto.slice(0, 500),
        dpia_ok: false,
      });
    }

    await supabase.from("agent_runs").insert({
      agent_name: "analyze_note",
      modelo: MODEL,
      scope_type: "owner",
      scope_id: owner_id ?? null,
      latencia_ms: Date.now() - t0,
      tokens_in: usage.prompt_tokens ?? null,
      tokens_out: usage.completion_tokens ?? null,
      confianza: analysis.confianza ?? null,
      resultado: analysis,
    });

    return new Response(JSON.stringify({ analysis }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze_note error", e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});