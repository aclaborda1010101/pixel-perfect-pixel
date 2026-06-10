// knowledge_ingest_file — extrae texto de docx/xlsx/pdf/txt subido al bucket "knowledge",
// trocea en chunks de ~300 palabras y los inserta en knowledge_chunks con embeddings.
// Body: { document_id: uuid } (la fila knowledge_documents ya debe existir con storage_path + origen)
import { createClient } from "jsr:@supabase/supabase-js@2";
import mammoth from "npm:mammoth@1.8.0";
import * as XLSX from "npm:xlsx@0.18.5";
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";
import { embed } from "../_shared/embed.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function chunkWords(text: string, target = 300): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const words = clean.split(" ");
  const out: string[] = [];
  for (let i = 0; i < words.length; i += target) {
    out.push(words.slice(i, i + target).join(" "));
  }
  return out;
}

async function extractFromBuffer(buf: ArrayBuffer, mime: string, name: string): Promise<string> {
  const lower = name.toLowerCase();
  if (mime?.includes("word") || lower.endsWith(".docx")) {
    const r = await mammoth.extractRawText({ arrayBuffer: buf });
    return r.value || "";
  }
  if (mime?.includes("sheet") || lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
    const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
    const parts: string[] = [];
    for (const name of wb.SheetNames) {
      const ws = wb.Sheets[name];
      parts.push(`# Hoja: ${name}\n${XLSX.utils.sheet_to_csv(ws)}`);
    }
    return parts.join("\n\n");
  }
  if (mime?.includes("pdf") || lower.endsWith(".pdf")) {
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n") : (text || "");
  }
  // text / markdown / json fallback
  return new TextDecoder().decode(buf);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { document_id } = await req.json();
    if (!document_id) throw new Error("document_id requerido");
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: doc, error: dErr } = await sb
      .from("knowledge_documents")
      .select("*")
      .eq("id", document_id)
      .maybeSingle();
    if (dErr || !doc) throw new Error("documento no encontrado");

    await sb.from("knowledge_documents").update({ status: "procesando", error: null, updated_at: new Date().toISOString() }).eq("id", document_id);
    // borra chunks antiguos si re-ingesta
    await sb.from("knowledge_chunks").delete().eq("document_id", document_id);

    const { data: file, error: fErr } = await sb.storage.from("knowledge").download(doc.storage_path);
    if (fErr || !file) throw new Error(`storage download: ${fErr?.message}`);
    const buf = await file.arrayBuffer();

    const text = await extractFromBuffer(buf, doc.mime_type || "", doc.nombre || doc.storage_path);
    const chunks = chunkWords(text, 300);

    let inserted = 0;
    for (let i = 0; i < chunks.length; i++) {
      const content = chunks[i];
      const v = await embed(content);
      const { error } = await sb.from("knowledge_chunks").insert({
        contenido: content,
        origen: doc.origen,
        document_id,
        metadatos: { nombre: doc.nombre, chunk_index: i, total_chunks: chunks.length },
        embedding: v as unknown as string ?? null,
      });
      if (!error) inserted++;
      else console.error("insert chunk", error);
    }

    await sb.from("knowledge_documents").update({
      num_chunks: inserted,
      status: inserted > 0 ? "ok" : "vacio",
      error: inserted === 0 ? "no se extrajo texto" : null,
      updated_at: new Date().toISOString(),
    }).eq("id", document_id);

    return new Response(JSON.stringify({ ok: true, inserted, total: chunks.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    try {
      const { document_id } = await req.clone().json().catch(() => ({}));
      if (document_id) {
        const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        await sb.from("knowledge_documents").update({ status: "error", error: msg }).eq("id", document_id);
      }
    } catch {}
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});