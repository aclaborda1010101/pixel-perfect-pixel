import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Eres "Asistente pre-llamada" del CRM AFFLUX, especialista en originación inmobiliaria.
Te dan el contexto de un propietario (datos, notas, llamadas previas, activos vinculados).
Devuelves un briefing breve y accionable para el operador comercial antes de llamar.
Sé conciso, factual y prudente. Si faltan datos, dilo explícitamente. No inventes hechos.
Responde en el idioma indicado.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { owner_id, locale = "es" } = await req.json();
    if (!owner_id) {
      return json({ error: "owner_id requerido" }, 400);
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY no configurada" }, 500);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [{ data: owner }, { data: notes }, { data: calls }, { data: assets }] =
      await Promise.all([
        supabase.from("owners").select("*").eq("id", owner_id).maybeSingle(),
        supabase.from("notes").select("texto, etiquetas, created_at").eq("owner_id", owner_id).order("created_at", { ascending: false }).limit(10),
        supabase.from("calls").select("fecha, direccion, resumen, siguiente_accion").eq("owner_id", owner_id).order("fecha", { ascending: false }).limit(10),
        supabase.from("assets").select("ubicacion, ciudad, tipo, valoracion_estimada, estado").eq("owner_id", owner_id),
      ]);

    if (!owner) return json({ error: "Propietario no encontrado" }, 404);

    const userPayload = {
      idioma: locale,
      propietario: owner,
      notas: notes ?? [],
      llamadas: calls ?? [],
      activos: assets ?? [],
    };

    const tools = [
      {
        type: "function",
        function: {
          name: "emit_brief",
          description: "Briefing pre-llamada estructurado.",
          parameters: {
            type: "object",
            properties: {
              contexto: { type: "string", description: "Resumen breve del estado actual del propietario." },
              objetivos: { type: "array", items: { type: "string" }, description: "Objetivos sugeridos para la llamada (3-5)." },
              preguntas_clave: { type: "array", items: { type: "string" }, description: "Preguntas que el operador debería hacer." },
              riesgos: { type: "array", items: { type: "string" }, description: "Riesgos, sensibilidades o flags de compliance." },
              proxima_accion_sugerida: { type: "string", description: "Próxima acción más probable tras la llamada." },
              confianza: { type: "number", description: "Confianza del briefing entre 0 y 1." },
            },
            required: ["contexto", "objetivos", "preguntas_clave", "riesgos", "proxima_accion_sugerida", "confianza"],
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
          { role: "user", content: JSON.stringify(userPayload) },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "emit_brief" } },
      }),
    });

    if (aiResp.status === 429) return json({ error: "Rate limit del Gateway AI. Reintenta en unos segundos." }, 429);
    if (aiResp.status === 402) return json({ error: "Sin créditos en Lovable AI. Añade saldo en Settings → Workspace → Usage." }, 402);
    if (!aiResp.ok) {
      const text = await aiResp.text();
      console.error("AI gateway error", aiResp.status, text);
      return json({ error: "Error en el modelo AI" }, 500);
    }

    const aiJson = await aiResp.json();
    const toolCall = aiJson.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) return json({ error: "Respuesta sin tool call" }, 500);

    const brief = JSON.parse(toolCall.function.arguments);
    const latency = Date.now() - start;

    await supabase.from("agent_runs").insert({
      agent_name: "agent_pre_call_brief",
      scope_type: "owner",
      scope_id: owner_id,
      modelo: "google/gemini-3-flash-preview",
      latencia_ms: latency,
      tokens_in: aiJson.usage?.prompt_tokens ?? null,
      tokens_out: aiJson.usage?.completion_tokens ?? null,
      confianza: brief.confianza,
      resultado: brief,
    });

    return json({ brief });
  } catch (e) {
    console.error("agent_pre_call_brief error", e);
    return json({ error: e instanceof Error ? e.message : "Error desconocido" }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}