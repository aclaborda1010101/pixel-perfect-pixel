// analyze_nota_simple — D.1 Notas Simples
// JWT-protected. Pipeline:
//   1) lee notas_simples por id, marca status=procesando
//   2) descarga PDF de Storage (bucket notas-simples)
//   3) extrae texto con unpdf (fallback: deja al modelo Gemini hacer OCR sobre el PDF inline)
//   4) llama Lovable AI Gateway (Gemini) con tool calling y schema definido
//   5) persiste structured_json + riesgo + processed_at + status=listo
//   6) loggea en agent_runs
// Re-disparable: cualquier paso fallido => status=error + error_message.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { extractText } from "npm:unpdf@0.12.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MODEL = "google/gemini-2.5-flash";

const TOOL = {
  type: "function",
  function: {
    name: "extract_nota_simple",
    description:
      "Extrae datos estructurados de una nota simple del Registro de la Propiedad español.",
    parameters: {
      type: "object",
      properties: {
        finca: {
          type: "object",
          properties: {
            numero: { type: "string", description: "Número de finca registral" },
            registro: { type: "string", description: "Registro de la Propiedad emisor" },
            ref_catastral: { type: "string" },
          },
          additionalProperties: false,
        },
        titulares: {
          type: "array",
          items: {
            type: "object",
            properties: {
              nombre: { type: "string" },
              cif_dni: { type: "string" },
              porcentaje: { type: "number", description: "Porcentaje de titularidad 0-100" },
              rol: {
                type: "string",
                enum: ["pleno", "usufructo", "nuda_propiedad"],
              },
            },
            required: ["nombre"],
            additionalProperties: false,
          },
        },
        cargas: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tipo: {
                type: "string",
                enum: ["hipoteca", "embargo", "anotacion", "servidumbre", "otra"],
              },
              acreedor: { type: "string" },
              importe: { type: "number" },
              fecha: { type: "string" },
              notas: { type: "string" },
            },
            required: ["tipo"],
            additionalProperties: false,
          },
        },
        superficie_m2: { type: "number" },
        linderos: { type: "string" },
        fecha_emision_nota: { type: "string" },
        divisible: { type: ["boolean", "null"] },
        riesgo: { type: "string", enum: ["alto", "medio", "bajo"] },
        riesgo_justificacion: { type: "string" },
      },
      required: ["titulares", "cargas", "riesgo", "riesgo_justificacion"],
      additionalProperties: false,
    },
  },
};

const SYS_PROMPT = `Eres un experto en derecho registral inmobiliario español. Analizas notas simples del Registro de la Propiedad y extraes información estructurada.
Reglas:
- Si no encuentras un campo, omítelo (no inventes).
- Porcentajes en formato 0-100 (ej: 50, no 0.5).
- "rol" del titular: "pleno" si es pleno dominio, "usufructo" si solo usufructo, "nuda_propiedad" si solo nuda propiedad.
- "riesgo" se evalúa así:
  - alto: embargo vigente, hipoteca con saldo elevado/dudoso, anotaciones de demanda, prohibiciones de disponer, herencias sin liquidar.
  - medio: hipoteca activa estándar, servidumbres, divisibilidad incierta, varios titulares con %s heterogéneos.
  - bajo: pleno dominio limpio, sin cargas relevantes.
- Devuelve siempre "riesgo_justificacion" en español, 1-2 frases concretas.`;

function jsonResponse(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);

  // JWT check (verify_jwt=true en config.toml ya valida; aquí extraemos user_id para logging).
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return jsonResponse({ error: "missing bearer token" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const t0 = Date.now();
  let notaId: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    notaId = body?.nota_simple_id ?? body?.nota_id ?? null;
    if (!notaId) return jsonResponse({ error: "nota_simple_id required" }, 400);

    const { data: nota, error: notaErr } = await supabase
      .from("notas_simples")
      .select("id, file_url, building_id, owner_id")
      .eq("id", notaId)
      .maybeSingle();
    if (notaErr) throw new Error(`db: ${notaErr.message}`);
    if (!nota) throw new Error("nota_simple no encontrada");
    if (!nota.file_url) throw new Error("nota_simple sin file_url");

    await supabase.from("notas_simples").update({
      status: "procesando",
      error_message: null,
    }).eq("id", notaId);

    // 2) descargar PDF
    const { data: blob, error: dlErr } = await supabase.storage
      .from("notas-simples")
      .download(nota.file_url);
    if (dlErr || !blob) throw new Error(`storage: ${dlErr?.message ?? "download failed"}`);

    const pdfBytes = new Uint8Array(await blob.arrayBuffer());

    // 3) extraer texto con unpdf
    let rawText = "";
    try {
      const ext = await extractText(pdfBytes, { mergePages: true });
      rawText = (typeof ext.text === "string" ? ext.text : (ext.text as string[]).join("\n")).trim();
    } catch (e) {
      console.warn("unpdf fallo, seguimos con PDF inline:", e);
    }

    // 4) Llamada a Lovable AI Gateway. Si hay texto suficiente, mandamos texto;
    // si no, mandamos el PDF inline en data URL para que Gemini haga OCR nativo.
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    let userContent: any;
    if (rawText.length >= 50) {
      userContent = `Analiza esta nota simple y devuelve la estructura. Texto extraído:\n\n${rawText.slice(0, 60000)}`;
    } else {
      // PDF inline (Gemini OCR)
      let bin = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < pdfBytes.length; i += chunkSize) {
        bin += String.fromCharCode(...pdfBytes.subarray(i, i + chunkSize));
      }
      const b64 = btoa(bin);
      userContent = [
        { type: "text", text: "Analiza esta nota simple (PDF adjunto) y devuelve la estructura completa." },
        { type: "image_url", image_url: { url: `data:application/pdf;base64,${b64}` } },
      ];
    }

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYS_PROMPT },
          { role: "user", content: userContent },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "extract_nota_simple" } },
      }),
    });

    if (!aiRes.ok) {
      const txt = await aiRes.text();
      if (aiRes.status === 429) throw new Error("Rate limit AI Gateway. Reintenta en unos segundos.");
      if (aiRes.status === 402) throw new Error("Sin créditos en Lovable AI. Recarga workspace.");
      throw new Error(`AI ${aiRes.status}: ${txt.slice(0, 300)}`);
    }
    const aiJson = await aiRes.json();
    const call = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    if (!call?.function?.arguments) {
      throw new Error("Modelo no devolvió tool_call");
    }
    const structured = JSON.parse(call.function.arguments);
    const usage = aiJson?.usage ?? {};

    // 5) persistir
    await supabase.from("notas_simples").update({
      status: "listo",
      raw_pdf_text: rawText.slice(0, 200_000) || null,
      structured_json: structured,
      riesgo: structured.riesgo ?? null,
      processed_at: new Date().toISOString(),
      error_message: null,
    }).eq("id", notaId);

    // 6) log agent_runs
    await supabase.from("agent_runs").insert({
      agent_name: "analyze_nota_simple",
      modelo: MODEL,
      scope_type: "notas_simples",
      scope_id: notaId,
      latencia_ms: Date.now() - t0,
      tokens_in: usage.prompt_tokens ?? null,
      tokens_out: usage.completion_tokens ?? null,
      resultado: { riesgo: structured.riesgo, n_titulares: structured.titulares?.length ?? 0, n_cargas: structured.cargas?.length ?? 0 },
    });

    return jsonResponse({ ok: true, nota_simple_id: notaId, structured });
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    console.error("analyze_nota_simple error:", msg);
    if (notaId) {
      await supabase.from("notas_simples").update({
        status: "error",
        error_message: msg.slice(0, 500),
      }).eq("id", notaId);
      await supabase.from("agent_runs").insert({
        agent_name: "analyze_nota_simple",
        modelo: MODEL,
        scope_type: "notas_simples",
        scope_id: notaId,
        latencia_ms: Date.now() - t0,
        error: msg.slice(0, 500),
      });
    }
    return jsonResponse({ error: msg }, 500);
  }
});