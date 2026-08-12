// PROCESO PUNTUAL Y REANUDABLE: recupera el texto de los PDF de las notas
// 'listo' que quedaron sin texto extraído (edificios 'a_revisar').
//
// No hay cron: se invoca a mano con la clave de operación, por lotes.
// Vía de extracción: la misma del proyecto (unpdf); si el PDF es un escaneo
// sin capa de texto, se transcribe con el modelo de Lovable AI (OCR nativo).
// Si no hay fichero fuente accesible => 'sin_pdf_fuente'.
// Si hay fichero pero no se puede leer nada => 'ilegible'.
// NO toca titulares ni estados de edificio: eso lo hace apply_reparse_168.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { extractText } from "npm:unpdf@0.12.1";

const MIN_TEXTO = 200;
const MODEL = "google/gemini-3.1-flash-lite-preview";

function b64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

async function ocr(bytes: Uint8Array): Promise<string> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return "";
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: "Transcribes documentos registrales tal cual. Devuelve SOLO el texto literal del documento, sin resumir, sin comentarios, sin inventar nada. Respeta nombres, DNI/CIF, porcentajes y los literales de derecho (pleno dominio, nuda propiedad, usufructo)." },
        { role: "user", content: [
          { type: "text", text: "Transcribe literalmente todo el texto de este PDF." },
          { type: "image_url", image_url: { url: `data:application/pdf;base64,${b64(bytes)}` } },
        ] },
      ],
    }),
  });
  if (!res.ok) return "";
  const j = await res.json().catch(() => null);
  const t = j?.choices?.[0]?.message?.content;
  return typeof t === "string" ? t.trim() : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const token = Deno.env.get("REPARSE168_TOKEN") ?? "";
  if (!token || req.headers.get("x-reparse-token") !== token) return json({ error: "no autorizado" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* vacío */ }
  const limite = Math.min(Number(body?.limite) || 20, 60);
  const usarOcr = body?.ocr !== false;
  const dryRun = body?.dry_run === true;
  const t0 = Date.now();
  const PRESUPUESTO_MS = 100_000;

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: edificios, error: eEd } = await sb.from("buildings").select("id").eq("porcentajes_estado", "a_revisar");
  if (eEd) return json({ error: eEd.message }, 500);
  const ids = (edificios ?? []).map((b: any) => b.id);

  // Notas candidatas: 'listo', sin texto utilizable, de edificios 'a_revisar'
  // y no marcadas ya como irrecuperables en una pasada anterior.
  const pend: any[] = [];
  for (let i = 0; i < ids.length && pend.length < limite * 4; i += 40) {
    const { data, error } = await sb.from("notas_simples")
      .select("id,building_id,file_url,raw_pdf_text,error_message")
      .eq("status", "listo")
      .in("building_id", ids.slice(i, i + 40));
    if (error) return json({ error: error.message }, 500);
    for (const n of data ?? []) {
      if ((n.raw_pdf_text ?? "").length >= MIN_TEXTO) continue;
      if (n.error_message === "sin_pdf_fuente" || n.error_message === "ilegible") continue;
      pend.push(n);
    }
  }

  const resumen = { candidatas: pend.length, procesadas: 0, con_texto: 0, via_unpdf: 0, via_ocr: 0, sin_pdf_fuente: 0, ilegible: 0, restantes: 0 };
  const detalle: any[] = [];

  for (const n of pend) {
    if (resumen.procesadas >= limite || Date.now() - t0 > PRESUPUESTO_MS) break;
    resumen.procesadas++;
    let motivo: string | null = null;
    let texto = "";
    let via = "";

    if (!n.file_url) {
      motivo = "sin_pdf_fuente";
    } else {
      const { data: blob, error: eDl } = await sb.storage.from("notas-simples").download(n.file_url);
      if (eDl || !blob) {
        motivo = "sin_pdf_fuente";
      } else {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        try {
          const ex = await extractText(bytes, { mergePages: true });
          texto = (typeof ex.text === "string" ? ex.text : (ex.text as string[]).join("\n")).trim();
          if (texto.length >= MIN_TEXTO) via = "unpdf";
        } catch (_e) { texto = ""; }
        if (texto.length < MIN_TEXTO && usarOcr) {
          const t = await ocr(bytes).catch(() => "");
          if (t.length > texto.length) { texto = t; via = "ocr"; }
        }
        if (texto.length < MIN_TEXTO) motivo = "ilegible";
      }
    }

    if (motivo) {
      resumen[motivo as "ilegible"]++;
      detalle.push({ nota_id: n.id, building_id: n.building_id, motivo });
      if (!dryRun) await sb.from("notas_simples").update({ error_message: motivo }).eq("id", n.id);
      continue;
    }

    resumen.con_texto++;
    if (via === "unpdf") resumen.via_unpdf++; else resumen.via_ocr++;
    detalle.push({ nota_id: n.id, building_id: n.building_id, via, caracteres: texto.length });
    if (!dryRun) {
      const { error: eUp } = await sb.from("notas_simples")
        .update({ raw_pdf_text: texto.slice(0, 200_000), error_message: null })
        .eq("id", n.id);
      if (eUp) return json({ error: eUp.message }, 500);
    }
  }

  resumen.restantes = Math.max(0, resumen.candidatas - resumen.procesadas);
  return json({ ok: true, dry_run: dryRun, resumen, detalle: detalle.slice(0, 100), ms: Date.now() - t0 });
});
