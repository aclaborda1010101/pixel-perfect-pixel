import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MODEL = "google/gemini-3-flash-preview";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const t0 = Date.now();
  try {
    const { owner_id, locale = "es" } = await req.json();
    if (!owner_id) {
      return new Response(JSON.stringify({ error: "owner_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const [{ data: owner }, { data: notes }, { data: calls }, { data: assets }] = await Promise.all([
      supabase.from("owners").select("*").eq("id", owner_id).maybeSingle(),
      supabase.from("notes").select("texto,created_at").eq("owner_id", owner_id).order("created_at", { ascending: false }).limit(10),
      supabase.from("calls").select("resumen,fecha,direccion").eq("owner_id", owner_id).order("fecha", { ascending: false }).limit(10),
      supabase.from("assets").select("tipo,ubicacion,ciudad,estado,valoracion_estimada").eq("owner_id", owner_id),
    ]);

    if (!owner) {
      return new Response(JSON.stringify({ error: "owner not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sys = locale === "en"
      ? "You are a real-estate origination assistant. Produce a precise, actionable pre-call briefing in English. Be concise, no fluff."
      : "Eres un asistente de originación inmobiliaria. Genera un briefing pre-llamada preciso y accionable en castellano. Sé conciso, sin paja.";

    const userPrompt = JSON.stringify({
      owner: {
        nombre: owner.nombre, rol: owner.rol, notas_breves: owner.notas_breves,
        consentimiento: owner.consentimiento,
      },
      ultimas_notas: notes ?? [],
      ultimas_llamadas: calls ?? [],
      activos: assets ?? [],
    });

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    const tools = [{
      type: "function",
      function: {
        name: "produce_brief",
        description: "Produce structured pre-call briefing",
        parameters: {
          type: "object",
          properties: {
            contexto: { type: "string" },
            objetivos: { type: "array", items: { type: "string" } },
            preguntas_clave: { type: "array", items: { type: "string" } },
            riesgos: { type: "array", items: { type: "string" } },
            proxima_accion_sugerida: { type: "string" },
            confianza: { type: "number" },
          },
          required: ["contexto", "objetivos", "preguntas_clave", "riesgos", "proxima_accion_sugerida", "confianza"],
          additionalProperties: false,
        },
      },
    }];

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userPrompt },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "produce_brief" } },
      }),
    });

    if (!aiRes.ok) {
      const txt = await aiRes.text();
      throw new Error(`AI error ${aiRes.status}: ${txt}`);
    }
    const aiJson = await aiRes.json();
    const call = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    const brief = JSON.parse(call?.function?.arguments ?? "{}");
    const usage = aiJson?.usage ?? {};

    await supabase.from("agent_runs").insert({
      agent_name: "pre_call_brief",
      modelo: MODEL,
      scope_type: "owner",
      scope_id: owner_id,
      latencia_ms: Date.now() - t0,
      tokens_in: usage.prompt_tokens ?? null,
      tokens_out: usage.completion_tokens ?? null,
      confianza: brief.confianza ?? null,
      resultado: brief,
    });

    return new Response(JSON.stringify({ brief }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("pre_call_brief error", e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});