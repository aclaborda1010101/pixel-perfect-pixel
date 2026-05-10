import { createClient } from "jsr:@supabase/supabase-js@2";
import { embed } from "../_shared/embed.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function chunkText(text: string, maxLen = 1200, overlap = 150): string[] {
  const t = (text || "").trim();
  if (!t) return [];
  if (t.length <= maxLen) return [t];
  const parts: string[] = [];
  let i = 0;
  while (i < t.length) {
    parts.push(t.slice(i, i + maxLen));
    if (i + maxLen >= t.length) break;
    i += maxLen - overlap;
  }
  return parts;
}

function pivotMomentsText(pm: unknown): string {
  if (!Array.isArray(pm) || pm.length === 0) return "";
  const lines = pm.map((p: any) => {
    const ts = p?.timestamp ?? p?.ts ?? "";
    const desc = p?.descripcion ?? p?.description ?? p?.text ?? "";
    const tipo = p?.tipo ?? p?.type ?? "";
    return `[PIVOT ${tipo}${ts ? ` @${ts}` : ""}] ${desc}`.trim();
  }).filter(Boolean);
  return lines.length ? `\n\nMomentos clave:\n${lines.join("\n")}` : "";
}

async function upsertChunks(
  supabase: any,
  origen: string,
  referencia_id: string,
  scope_type: string | null,
  scope_id: string | null,
  chunks: string[],
  baseMeta: Record<string, unknown>,
) {
  // Delete previous chunks for this source (idempotency)
  await supabase.from("knowledge_chunks")
    .delete()
    .eq("origen", origen)
    .eq("referencia_id", referencia_id);

  let inserted = 0;
  let withEmbedding = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const v = await embed(c);
    const { error } = await supabase.from("knowledge_chunks").insert({
      contenido: c,
      origen,
      referencia_id,
      scope_type,
      scope_id,
      metadatos: { ...baseMeta, chunk_index: i, total_chunks: chunks.length },
      embedding: v as unknown as string ?? null,
    });
    if (!error) {
      inserted++;
      if (v) withEmbedding++;
    } else {
      console.error("insert error", origen, referencia_id, error.message);
    }
  }
  return { inserted, withEmbedding };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = Math.min(Number(body?.limit ?? 200), 1000);
    const force = body?.force === true;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const stats = {
      notes: { scanned: 0, processed: 0, chunks: 0, embedded: 0 },
      calls: { scanned: 0, processed: 0, chunks: 0, embedded: 0 },
      whatsapp: { scanned: 0, processed: 0, chunks: 0, embedded: 0 },
    };

    // Existing referencia_ids by origen for skip
    async function existingIds(origen: string): Promise<Set<string>> {
      if (force) return new Set();
      const set = new Set<string>();
      let from = 0; const page = 1000;
      while (true) {
        const { data, error } = await supabase
          .from("knowledge_chunks")
          .select("referencia_id")
          .eq("origen", origen)
          .not("referencia_id", "is", null)
          .range(from, from + page - 1);
        if (error || !data || data.length === 0) break;
        for (const r of data) if (r.referencia_id) set.add(r.referencia_id);
        if (data.length < page) break;
        from += page;
      }
      return set;
    }

    // ---------- NOTES ----------
    {
      const existing = await existingIds("note");
      const { data: notes } = await supabase
        .from("notes")
        .select("id, texto, owner_id, asset_id, etiquetas, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      stats.notes.scanned = notes?.length ?? 0;
      for (const n of notes ?? []) {
        if (!n.texto || existing.has(n.id)) continue;
        const chunks = chunkText(n.texto);
        if (chunks.length === 0) continue;
        const scope_type = n.owner_id ? "owner" : (n.asset_id ? "asset" : null);
        const scope_id = n.owner_id ?? n.asset_id ?? null;
        const r = await upsertChunks(supabase, "note", n.id, scope_type, scope_id, chunks, {
          etiquetas: n.etiquetas ?? [], created_at: n.created_at,
        });
        stats.notes.processed++;
        stats.notes.chunks += r.inserted;
        stats.notes.embedded += r.withEmbedding;
      }
    }

    // ---------- CALLS ----------
    {
      const existing = await existingIds("call");
      const { data: calls } = await supabase
        .from("calls")
        .select("id, transcripcion, resumen, pivot_moments, tacticas_usadas, frases_clave_positivas, frases_clave_negativas, objeciones, owner_id, fecha, comercial_nombre, outcome")
        .not("transcripcion", "is", null)
        .order("fecha", { ascending: false })
        .limit(limit);
      stats.calls.scanned = calls?.length ?? 0;
      for (const c of calls ?? []) {
        if (existing.has(c.id)) continue;
        const header = `Llamada ${c.fecha ?? ""}${c.comercial_nombre ? ` con ${c.comercial_nombre}` : ""}${c.outcome ? ` — ${c.outcome}` : ""}.`;
        const resumen = c.resumen ? `Resumen: ${c.resumen}` : "";
        const pivots = pivotMomentsText(c.pivot_moments);
        const tags = [
          c.tacticas_usadas?.length ? `Tácticas: ${c.tacticas_usadas.join(", ")}` : "",
          c.objeciones?.length ? `Objeciones: ${c.objeciones.join(", ")}` : "",
          c.frases_clave_positivas?.length ? `Frases +: ${c.frases_clave_positivas.join(" | ")}` : "",
          c.frases_clave_negativas?.length ? `Frases -: ${c.frases_clave_negativas.join(" | ")}` : "",
        ].filter(Boolean).join("\n");
        const body = `${header}\n${resumen}\n${tags}${pivots}\n\nTranscripción:\n${c.transcripcion}`;
        const chunks = chunkText(body, 1400, 200);
        if (chunks.length === 0) continue;
        const r = await upsertChunks(supabase, "call", c.id, c.owner_id ? "owner" : null, c.owner_id ?? null, chunks, {
          fecha: c.fecha, outcome: c.outcome, comercial: c.comercial_nombre,
          has_pivots: Array.isArray(c.pivot_moments) && c.pivot_moments.length > 0,
        });
        stats.calls.processed++;
        stats.calls.chunks += r.inserted;
        stats.calls.embedded += r.withEmbedding;
      }
    }

    // ---------- WHATSAPP ----------
    {
      const existing = await existingIds("whatsapp");
      const { data: msgs } = await supabase
        .from("whatsapp_messages")
        .select("id, cuerpo, owner_id, building_id, direccion, enviado_at, created_at")
        .not("cuerpo", "is", null)
        .order("created_at", { ascending: false })
        .limit(limit);
      stats.whatsapp.scanned = msgs?.length ?? 0;
      for (const m of msgs ?? []) {
        if (!m.cuerpo || existing.has(m.id)) continue;
        const body = `[WhatsApp ${m.direccion ?? ""} ${m.enviado_at ?? m.created_at ?? ""}]\n${m.cuerpo}`;
        const scope_type = m.owner_id ? "owner" : (m.building_id ? "building" : null);
        const scope_id = m.owner_id ?? m.building_id ?? null;
        const r = await upsertChunks(supabase, "whatsapp", m.id, scope_type, scope_id, [body], {
          direccion: m.direccion, enviado_at: m.enviado_at,
        });
        stats.whatsapp.processed++;
        stats.whatsapp.chunks += r.inserted;
        stats.whatsapp.embedded += r.withEmbedding;
      }
    }

    return new Response(JSON.stringify({ ok: true, stats }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate_embeddings error", e);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});