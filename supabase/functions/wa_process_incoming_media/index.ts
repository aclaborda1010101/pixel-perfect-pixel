// Procesa multimedia entrante (audio/imagen/documento) antes de que el bot responda.
// Audio  → transcribe con Lovable AI Speech-to-Text.
// Imagen → describe con Gemini multimodal (lo que se ve, datos relevantes del lead/edificio).
// PDF/doc→ resume contenido con Gemini multimodal cuando es PDF; otros tipos → marca no soportado.
import { createClient } from "npm:@supabase/supabase-js@2";
import { evoFetch, EVOLUTION_INSTANCE } from "../_shared/evolution.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function downloadMediaBase64(rawMsg: any): Promise<{ base64: string; mimetype?: string }> {
  // Evolution API v2: /chat/getBase64FromMediaMessage/{instance}
  const body = { message: rawMsg, convertToMp4: false };
  const res = await evoFetch(`/chat/getBase64FromMediaMessage/${EVOLUTION_INSTANCE}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const base64 = res?.base64 ?? res?.data ?? res?.media ?? null;
  if (!base64) throw new Error("Evolution no devolvió base64 del media");
  return { base64: String(base64), mimetype: res?.mimetype ?? undefined };
}

function extFromMime(mt?: string): string {
  if (!mt) return "ogg";
  if (mt.includes("ogg")) return "ogg";
  if (mt.includes("mpeg")) return "mp3";
  if (mt.includes("mp3")) return "mp3";
  if (mt.includes("wav")) return "wav";
  if (mt.includes("webm")) return "webm";
  if (mt.includes("mp4") || mt.includes("m4a")) return "m4a";
  if (mt.includes("aac")) return "aac";
  if (mt.includes("flac")) return "flac";
  return "ogg";
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { message_id, conversation_id } = await req.json();
    if (!message_id || !conversation_id) {
      return new Response(JSON.stringify({ error: "message_id y conversation_id requeridos" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(SUPABASE_URL, SERVICE);

    const { data: row } = await admin
      .from("wa_messages")
      .select("id, type, metadata, content")
      .eq("id", message_id).single();
    if (!row) return new Response(JSON.stringify({ error: "msg not found" }), { status: 404, headers: corsHeaders });

    const meta = (row as any).metadata ?? {};
    const media = meta.media ?? {};
    const rawMsg = meta.raw;
    const kind = media.kind ?? row.type;

    if (media.processing === "done") {
      return new Response(JSON.stringify({ ok: true, skip: "already done" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let extractedText = "";
    let processingError: string | null = null;
    try {
      const dl = await downloadMediaBase64(rawMsg);
      const mime = media.mimetype ?? dl.mimetype ?? "";

      if (kind === "audio") {
        const ext = extFromMime(mime);
        const bytes = b64ToBytes(dl.base64);
        const fd = new FormData();
        fd.append("model", "openai/gpt-4o-mini-transcribe");
        fd.append("file", new Blob([bytes], { type: mime || `audio/${ext}` }), `audio.${ext}`);
        const stt = await fetch("https://ai.gateway.lovable.dev/v1/audio/transcriptions", {
          method: "POST",
          headers: { Authorization: `Bearer ${LOVABLE_API_KEY}` },
          body: fd,
        });
        if (!stt.ok) throw new Error(`STT ${stt.status}: ${await stt.text().catch(() => "")}`);
        const j = await stt.json();
        extractedText = String(j?.text ?? "").trim();
      } else if (kind === "image") {
        const dataUrl = `data:${mime || "image/jpeg"};base64,${dl.base64}`;
        const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              { role: "system", content: "Describe en castellano de España, en 2-4 frases, qué se ve en esta imagen enviada por un propietario por WhatsApp. Si aparece un edificio, fachada, escritura, factura, nota simple, plano o documento inmobiliario, extrae los datos relevantes (dirección, número de viviendas, propietarios, importes, fechas). Sé conciso y útil para un comercial." },
              { role: "user", content: [
                { type: "text", text: media.caption ? `Pie de la imagen: ${media.caption}` : "Imagen del lead" },
                { type: "image_url", image_url: { url: dataUrl } },
              ]},
            ],
          }),
        });
        if (!aiRes.ok) throw new Error(`Vision ${aiRes.status}: ${await aiRes.text().catch(() => "")}`);
        const aj = await aiRes.json();
        extractedText = String(aj?.choices?.[0]?.message?.content ?? "").trim();
      } else if (kind === "document") {
        if (mime.includes("pdf")) {
          const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                { role: "system", content: "Resume en castellano de España, en 4-6 frases, este documento PDF que un propietario nos ha enviado por WhatsApp. Extrae los datos clave útiles para un comercial inmobiliario (dirección, propietarios, rentas, vencimientos, cargas, fechas, importes)." },
                { role: "user", content: [
                  { type: "text", text: media.filename ? `Archivo: ${media.filename}` : "Documento PDF del lead" },
                  { type: "file", file: { filename: media.filename ?? "doc.pdf", file_data: `data:application/pdf;base64,${dl.base64}` } },
                ]},
              ],
            }),
          });
          if (!aiRes.ok) throw new Error(`PDF ${aiRes.status}: ${await aiRes.text().catch(() => "")}`);
          const aj = await aiRes.json();
          extractedText = String(aj?.choices?.[0]?.message?.content ?? "").trim();
        } else {
          extractedText = `[Documento adjunto${media.filename ? `: ${media.filename}` : ""} (${mime || "tipo no soportado"})]`;
        }
      } else {
        extractedText = `[${kind} no soportado]`;
      }
    } catch (e: any) {
      processingError = e?.message ?? String(e);
    }

    const finalContent = (() => {
      const cap = media.caption ? `${media.caption}\n\n` : "";
      if (processingError) return `${cap}[No se pudo procesar el ${kind}: ${processingError}]`;
      const tag =
        kind === "audio" ? "🎤 Audio (transcrito)"
        : kind === "image" ? "🖼️ Imagen (descripción)"
        : kind === "document" ? "📄 Documento (resumen)"
        : `(${kind})`;
      return `${cap}${tag}:\n${extractedText || "(sin contenido legible)"}`;
    })();

    await admin.from("wa_messages").update({
      content: finalContent,
      metadata: {
        ...meta,
        media: {
          ...media,
          processing: processingError ? "failed" : "done",
          error: processingError,
          extracted_at: new Date().toISOString(),
        },
      },
    }).eq("id", message_id);

    // Disparar respuesta del bot ahora que el contenido es legible
    fetch(`${SUPABASE_URL}/functions/v1/wa_ai_reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
      body: JSON.stringify({ conversation_id }),
    }).catch(() => {});

    return new Response(JSON.stringify({ ok: true, kind, error: processingError }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});