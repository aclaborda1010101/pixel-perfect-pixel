import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MODEL = "google/gemini-2.5-pro";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let notaId: string | null = null;
  try {
    const { nota_id } = await req.json();
    if (!nota_id) {
      return new Response(JSON.stringify({ error: "nota_id required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    notaId = nota_id;

    const { data: nota, error: notaErr } = await supabase
      .from("notas_simples")
      .select("id, file_url")
      .eq("id", nota_id)
      .maybeSingle();
    if (notaErr || !nota) throw new Error(notaErr?.message ?? "nota not found");
    if (!nota.file_url) throw new Error("nota sin file_url");

    await supabase.from("notas_simples")
      .update({ status: "procesando", error_message: null })
      .eq("id", nota_id);

    // Download PDF from storage. file_url is the path inside the bucket.
    const { data: file, error: dlErr } = await supabase.storage
      .from("notas-simples").download(nota.file_url);
    if (dlErr || !file) throw new Error(dlErr?.message ?? "no se pudo descargar PDF");
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const b64 = btoa(bin);

    const sys = `Eres un experto en notas simples del Registro de la Propiedad español. Analiza el PDF y extrae la información estructurada. Detecta riesgos: cargas, hipotecas, embargos, afecciones fiscales, prohibiciones, anotaciones preventivas, herencias sin liquidar.`;

    const tools = [{
      type: "function",
      function: {
        name: "extract_nota",
        parameters: {
          type: "object",
          properties: {
            finca: {
              type: "object",
              properties: {
                idufir: { type: "string" },
                referencia_catastral: { type: "string" },
                direccion: { type: "string" },
                ciudad: { type: "string" },
                codigo_postal: { type: "string" },
                superficie_m2: { type: "number" },
                descripcion: { type: "string" },
              },
              additionalProperties: false,
            },
            titulares: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  nombre: { type: "string" },
                  nif: { type: "string" },
                  cuota: { type: "string" },
                  titulo: { type: "string" },
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
                  tipo: { type: "string", description: "hipoteca, embargo, servidumbre, afeccion_fiscal, anotacion, otro" },
                  descripcion: { type: "string" },
                  importe: { type: "number" },
                  acreedor: { type: "string" },
                  fecha: { type: "string" },
                  vigente: { type: "boolean" },
                },
                required: ["tipo", "descripcion"],
                additionalProperties: false,
              },
            },
            riesgo: {
              type: "string",
              enum: ["bajo", "medio", "alto"],
            },
            riesgo_motivos: { type: "array", items: { type: "string" } },
            resumen: { type: "string" },
          },
          required: ["riesgo", "resumen", "titulares", "cargas"],
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
          {
            role: "user",
            content: [
              { type: "text", text: "Analiza esta nota simple y devuelve la estructura completa." },
              { type: "image_url", image_url: { url: `data:application/pdf;base64,${b64}` } },
            ],
          },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "extract_nota" } },
      }),
    });

    if (!aiRes.ok) {
      const txt = await aiRes.text();
      if (aiRes.status === 429) throw new Error("Rate limit del AI Gateway. Reintenta en unos segundos.");
      if (aiRes.status === 402) throw new Error("Sin créditos en Lovable AI. Recarga en Settings.");
      throw new Error(`AI error ${aiRes.status}: ${txt.slice(0, 300)}`);
    }
    const aiJson = await aiRes.json();
    const call = aiJson?.choices?.[0]?.message?.tool_calls?.[0];
    const structured = JSON.parse(call?.function?.arguments ?? "{}");

    await supabase.from("notas_simples").update({
      status: "listo",
      structured_json: structured,
      riesgo: structured.riesgo ?? null,
      processed_at: new Date().toISOString(),
      error_message: null,
    }).eq("id", nota_id);

    return new Response(JSON.stringify({ ok: true, structured }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = String((e as Error).message ?? e);
    console.error("analyze_nota_simple error", msg);
    if (notaId) {
      await supabase.from("notas_simples").update({
        status: "error",
        error_message: msg,
      }).eq("id", notaId);
    }
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});