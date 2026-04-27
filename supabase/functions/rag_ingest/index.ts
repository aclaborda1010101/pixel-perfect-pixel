import { createClient } from "jsr:@supabase/supabase-js@2";
import { embed } from "../_shared/embed.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Item = {
  contenido: string;
  origen: string;
  referencia_id?: string;
  scope_type?: string;
  scope_id?: string;
  metadatos?: Record<string, unknown>;
};

function chunk(text: string, maxLen = 800): string[] {
  const t = text.trim();
  if (t.length <= maxLen) return [t];
  const parts: string[] = [];
  let i = 0;
  while (i < t.length) {
    parts.push(t.slice(i, i + maxLen));
    i += maxLen;
  }
  return parts;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const items: Item[] = Array.isArray(body?.items) ? body.items : [body];
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let inserted = 0;
    let withEmbedding = 0;
    for (const it of items) {
      if (!it?.contenido || !it?.origen) continue;
      const chunks = chunk(it.contenido);
      for (const c of chunks) {
        const v = await embed(c);
        const { error } = await supabase.from("knowledge_chunks").insert({
          contenido: c,
          origen: it.origen,
          referencia_id: it.referencia_id ?? null,
          scope_type: it.scope_type ?? null,
          scope_id: it.scope_id ?? null,
          metadatos: it.metadatos ?? {},
          embedding: v as unknown as string ?? null,
        });
        if (!error) {
          inserted++;
          if (v) withEmbedding++;
        } else {
          console.error("ingest error", error);
        }
      }
    }

    return new Response(JSON.stringify({ inserted, withEmbedding }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});