// Genera jobs de enriquecimiento a partir de la nota simple más reciente del edificio
// y dispara el agente inmediatamente (sin esperar al cron).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function detectTipo(nombre: string): "persona" | "empresa" {
  return /\b(SL|SA|SLU|SAU|SCP|SC|SLNE|COOP|CB|UTE|CORP|HOLDING|INMOBILIARIA)\b/i.test(nombre)
    ? "empresa" : "persona";
}

function splitNombre(full: string) {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { nombre: parts[0], a1: null, a2: null };
  if (parts.length === 2) return { nombre: parts[0], a1: parts[1], a2: null };
  // último y penúltimo son apellidos
  const a2 = parts.pop()!;
  const a1 = parts.pop()!;
  return { nombre: parts.join(" "), a1, a2 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const building_id = body.building_id as string | undefined;
    const titulares_manual = body.titulares as any[] | undefined;
    if (!building_id) {
      return new Response(JSON.stringify({ error: "building_id requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let titulares: any[] = titulares_manual ?? [];
    let nota_simple_id: string | null = null;

    if (!titulares.length) {
      const { data: nota } = await supabase
        .from("notas_simples")
        .select("id, structured_json")
        .eq("building_id", building_id)
        .eq("status", "listo")
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      if (nota) {
        nota_simple_id = nota.id;
        titulares = (nota.structured_json?.titulares ?? []) as any[];
      }
    }

    if (!titulares.length) {
      return new Response(JSON.stringify({ error: "sin titulares en nota simple" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rows = titulares.map((t: any) => {
      const nombre = (t.nombre || t.razon_social || "").trim();
      const tipo = t.tipo || detectTipo(nombre);
      const parts = tipo === "persona" ? splitNombre(nombre) : { nombre, a1: null, a2: null };
      return {
        building_id,
        nota_simple_id,
        titular_nombre: parts.nombre,
        titular_apellido1: parts.a1,
        titular_apellido2: parts.a2,
        titular_tipo: tipo,
        titular_nif: t.nif ?? null,
        titular_pct: t.pct ?? null,
        fase: tipo === "empresa" ? "datoscif" : "inglobaly",
        estado: "pendiente",
        datos: { origen: "nota_simple", raw: t },
      };
    });

    const { data: inserted, error } = await supabase
      .from("enrichment_jobs").insert(rows).select("id, titular_nombre, fase");
    if (error) throw error;

    // Dispara agente sin esperar
    fetch(`${SUPABASE_URL}/functions/v1/enrichment-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: "{}",
    }).catch(() => {});

    return new Response(JSON.stringify({ ok: true, jobs: inserted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});