import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Eres "Analizador de notas comerciales" del CRM AFFLUX.
Recibes una nota o transcripción de llamada con un propietario inmobiliario.
Extraes hechos objetivos, intenciones del propietario y propones una próxima acción concreta para el equipo comercial.
No inventes datos. Si la información es insuficiente o sensible (DPIA, fallecimiento, herencia, datos de salud), márcalo en "requiere_revision".
Responde en el idioma indicado.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { texto, owner_id, asset_id, locale = "es" } = await req.json();
    if (!texto || typeof texto !== "string" || texto.trim().length < 10) {
      return json({ error: "texto requerido (mínimo 10 caracteres)" }, 400);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY no configurada" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const tools = [
      {
        type: "function",
        function: {
          name: "emit_analysis",
          description: "Análisis estructurado de una nota/transcripción.",
          parameters: {
            type: "object",
            properties: {
              hechos: { type: "array", items: { type: "string" } },
              intenciones: { type: "array", items: { type: "string" } },
              sentimiento: { type: "string", enum: ["positivo", "neutro", "negativo"] },
              proxima_accion: {
                type: "object",
                properties: {
                  titulo: { type: "string" },
                  detalle: { type: "string" },
                  vencimiento_dias: { type: "integer" },
                },
                required: ["titulo", "detalle", "vencimiento_dias"],
                additionalProperties: false,
              },
              etiquetas: { type: "array", items: { type: "string" } },
              requiere_revision: { type: "boolean" },
              motivo_revision: { type: "string" },
              confianza: { type: "number" },
            },
            required: ["hechos", "intenciones", "sentimiento", "proxima_accion", "etiquetas", "requiere_revision", "confianza"],
            additionalProperties: false,
          },
        },
      },
    ];

    const start = Date.now();
    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify({ idioma: locale, texto }) },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "emit_analysis" } },
      }),
    });

    if (aiResp.status === 429) return json({ error: "Rate limit del Gateway AI." }, 429);
    if (aiResp.status === 402) return json({ error: "Sin créditos en Lovable AI." }, 402);
    if (!aiResp.ok) {
      const text = await aiResp.text();
      console.error("AI gateway error", aiResp.status, text);
      return json({ error: "Error en el modelo AI" }, 500);
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) return json({ error: "Respuesta sin tool call" }, 500);
    const analysis = JSON.parse(toolCall.function.arguments);
    const latency = Date.now() - start;

    await supabase.from("agent_runs").insert({
      agent_name: "agent_analyze_note",
      scope_type: owner_id ? "owner" : asset_id ? "asset" : null,
      scope_id: owner_id ?? asset_id ?? null,
      modelo: "google/gemini-3-flash-preview",
      latencia_ms: latency,
      tokens_in: aiJson.usage?.prompt_tokens ?? null,
      tokens_out: aiJson.usage?.completion_tokens ?? null,
      confianza: analysis.confianza,
      resultado: analysis,
    });

    if (analysis.requiere_revision) {
      await supabase.from("compliance_cases").insert({
        scope_type: owner_id ? "owner" : "asset",
        scope_id: owner_id ?? asset_id ?? null,
        estado: "pendiente",
        dpia_ok: false,
        motivo: analysis.motivo_revision ?? "Análisis de nota requiere revisión humana",
        evidencia: texto.slice(0, 500),
      });
    }

    return json({ analysis });
  } catch (e) {
    console.error("agent_analyze_note error", e);
    return json({ error: e instanceof Error ? e.message : "Error desconocido" }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}