import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MODEL = "google/gemini-3-flash-preview";

function bucketHour(h: number): string {
  if (h < 10) return "mañana temprano (8-10h)";
  if (h < 13) return "media mañana (10-13h)";
  if (h < 16) return "mediodía (13-16h)";
  if (h < 19) return "tarde (16-19h)";
  return "tarde-noche (19-21h)";
}

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

    const [{ data: owner }, { data: calls }, { data: assets }, { data: nota }, { data: ownerBuildings }] = await Promise.all([
      supabase.from("owners").select("*").eq("id", owner_id).maybeSingle(),
      supabase.from("calls").select("resumen,fecha,direccion,outcome,notas_post_llamada").eq("owner_id", owner_id).order("fecha", { ascending: false }).limit(20),
      supabase.from("assets").select("tipo,ubicacion,ciudad,estado,valoracion_estimada").eq("owner_id", owner_id),
      supabase.from("notas_simples").select("structured_json").eq("owner_id", owner_id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("building_owners").select("building_id,cuota,subrole").eq("owner_id", owner_id).limit(5),
    ]);

    if (!owner) {
      return new Response(JSON.stringify({ error: "owner not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Stats propias del owner
    const intentos = (calls ?? []).length;
    const conResumen = (calls ?? []).filter((c: any) => (c.resumen ?? "").trim().length > 30 && c.outcome !== "no_contesta").length;
    const outcomes: Record<string, number> = {};
    const franjas: Record<string, number> = {};
    for (const c of calls ?? []) {
      if (c.outcome) outcomes[c.outcome] = (outcomes[c.outcome] ?? 0) + 1;
      if (c.fecha) {
        const h = new Date(c.fecha).getHours();
        const b = bucketHour(h);
        franjas[b] = (franjas[b] ?? 0) + 1;
      }
    }
    const ultimoIntento = calls?.[0]?.fecha ?? null;
    const gapDias = ultimoIntento ? Math.floor((Date.now() - new Date(ultimoIntento).getTime()) / 86400000) : null;
    const modo: "con_historico" | "primer_contacto" = conResumen > 0 ? "con_historico" : "primer_contacto";

    // Contexto peers (mismo edificio) si tenemos building
    let peers: any = null;
    const buildingId = ownerBuildings?.[0]?.building_id ?? null;
    if (buildingId) {
      const { data: bowners } = await supabase
        .from("building_owners")
        .select("owner_id,cuota,subrole")
        .eq("building_id", buildingId);
      const peerIds = (bowners ?? []).map((b: any) => b.owner_id).filter((id: string) => id !== owner_id);
      let contactados = 0;
      let outcomesPeers: Record<string, number> = {};
      if (peerIds.length > 0) {
        const { data: peerCalls } = await supabase
          .from("calls")
          .select("owner_id,outcome,resumen")
          .in("owner_id", peerIds);
        const contactadosSet = new Set<string>();
        for (const c of peerCalls ?? []) {
          if ((c.resumen ?? "").trim().length > 30) contactadosSet.add(c.owner_id);
          if (c.outcome) outcomesPeers[c.outcome] = (outcomesPeers[c.outcome] ?? 0) + 1;
        }
        contactados = contactadosSet.size;
      }
      peers = {
        total_propietarios: (bowners ?? []).length,
        peers_total: peerIds.length,
        peers_contactados: contactados,
        outcomes_peers: outcomesPeers,
      };
    }

    const structured = (nota?.structured_json ?? {}) as any;
    const cargas = structured.cargas ?? [];
    const divisible = structured.divisible ?? null;

    const sys = locale === "en"
      ? "You are a real-estate origination coach. Produce a concise, actionable pre-call briefing in English. Avoid fluff. Use the data; if histórico is empty, fall back to first-contact playbook + peer context."
      : `Eres un coach de originación inmobiliaria. Genera un briefing pre-llamada accionable en castellano, sin paja.
Reglas:
- Si modo="con_historico": basa tips en los patrones reales (franja, gap, outcomes, temas).
- Si modo="primer_contacto": usa playbook de primer contacto + datos de peers del mismo edificio si existen.
- Openers deben ser frases listas para leer en voz alta (≤25 palabras).
- Objeciones: las 3 más probables según el contexto, con respuesta breve (1-2 frases).
- Tips: marcar correctamente el tipo (historico / patron_peers / buena_practica).
- proxima_accion: una sola frase concreta y medible.`;

    const userPayload = {
      modo,
      owner: {
        nombre: owner.nombre, rol: owner.rol, notas_breves: owner.notas_breves,
        consentimiento: owner.consentimiento, telefono: !!owner.telefono,
      },
      stats_owner: {
        intentos_totales: intentos,
        intentos_con_conversacion: conResumen,
        outcomes,
        franjas_horarias_usadas: franjas,
        gap_dias_desde_ultimo_intento: gapDias,
      },
      ultimas_llamadas: (calls ?? []).slice(0, 8).map((c: any) => ({
        fecha: c.fecha, outcome: c.outcome, resumen: (c.resumen ?? "").slice(0, 400),
      })),
      activos: assets ?? [],
      nota_simple: { cargas_count: cargas.length, cargas_tipos: cargas.map((c: any) => c.tipo).slice(0, 5), divisible },
      peers,
    };

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    const tools = [{
      type: "function",
      function: {
        name: "produce_brief",
        description: "Produce visual, actionable pre-call briefing",
        parameters: {
          type: "object",
          properties: {
            modo: { type: "string", enum: ["con_historico", "primer_contacto"] },
            confianza: { type: "number" },
            resumen: { type: "string", description: "1-2 frases sintéticas sobre el propietario y momento" },
            estado_relacion: { type: "string", description: "frío | tibio | caliente, con matiz breve" },
            intencion_llamada: { type: "string", description: "Objetivo nº1 de esta llamada concreta" },
            mejor_momento: {
              type: ["object", "null"],
              properties: {
                franja: { type: "string" },
                razon: { type: "string" },
              },
              required: ["franja", "razon"],
              additionalProperties: false,
            },
            openers: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 3 },
            preguntas_clave: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 5 },
            objeciones: {
              type: "array",
              minItems: 2,
              maxItems: 4,
              items: {
                type: "object",
                properties: {
                  objecion: { type: "string" },
                  respuesta: { type: "string" },
                },
                required: ["objecion", "respuesta"],
                additionalProperties: false,
              },
            },
            tips: {
              type: "array",
              minItems: 2,
              maxItems: 6,
              items: {
                type: "object",
                properties: {
                  tipo: { type: "string", enum: ["historico", "patron_peers", "buena_practica"] },
                  texto: { type: "string" },
                },
                required: ["tipo", "texto"],
                additionalProperties: false,
              },
            },
            riesgos: { type: "array", items: { type: "string" } },
            proxima_accion: { type: "string" },
            contexto_peers: { type: ["string", "null"] },
          },
          required: [
            "modo", "confianza", "resumen", "estado_relacion", "intencion_llamada",
            "mejor_momento", "openers", "preguntas_clave", "objeciones", "tips",
            "riesgos", "proxima_accion", "contexto_peers",
          ],
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
          { role: "user", content: JSON.stringify(userPayload) },
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

    return new Response(JSON.stringify({ brief, meta: { modo, intentos, conResumen, gapDias } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("pre_call_brief error", e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});