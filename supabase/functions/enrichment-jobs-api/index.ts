// Fallback REST para operador externo (skill navegador).
// Autenticación: header X-Enrichment-Key con secret ENRICHMENT_API_KEY.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-enrichment-key",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_KEY = Deno.env.get("ENRICHMENT_API_KEY") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const headerKey = req.headers.get("x-enrichment-key") ?? "";
  if (!API_KEY || headerKey !== API_KEY) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? (req.method === "GET" ? "pending" : "result");

  if (action === "pending") {
    const fase = url.searchParams.get("fase") ?? "inglobaly";
    const limit = Math.min(Number(url.searchParams.get("limit") ?? "5"), 20);
    const lease = crypto.randomUUID();
    const { data, error } = await supabase
      .from("enrichment_jobs")
      .update({
        estado: "en_curso", lease_token: lease,
        lease_until: new Date(Date.now() + 600000).toISOString(),
      })
      .in("estado", ["esperando_navegador", "requiere_revision"])
      .eq("fase", fase)
      .select("id, titular_nombre, titular_apellido1, titular_apellido2, titular_nif, titular_tipo, datos, fase")
      .limit(limit);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
    return new Response(JSON.stringify({ lease_token: lease, jobs: data ?? [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (action === "result") {
    const body = await req.json();
    const { job_id, lease_token, resultado, error: errMsg } = body ?? {};
    if (!job_id) return new Response(JSON.stringify({ error: "job_id requerido" }), { status: 400, headers: corsHeaders });
    const { data: job } = await supabase.from("enrichment_jobs").select("*").eq("id", job_id).maybeSingle();
    if (!job) return new Response(JSON.stringify({ error: "no encontrado" }), { status: 404, headers: corsHeaders });
    if (lease_token && job.lease_token !== lease_token) {
      return new Response(JSON.stringify({ error: "lease inválido" }), { status: 409, headers: corsHeaders });
    }
    if (errMsg) {
      await supabase.from("enrichment_jobs").update({
        estado: "requiere_revision", error: errMsg,
        lease_token: null, lease_until: null,
      }).eq("id", job_id);
    } else {
      const datosNuevos = { ...(job.datos ?? {}), [job.fase]: resultado };
      const nextFase = job.fase === "inglobaly" ? "tecnofind" : "verificacion";
      await supabase.from("enrichment_jobs").update({
        estado: "ok", fase: nextFase, datos: datosNuevos,
        lease_token: null, lease_until: null,
      }).eq("id", job_id);
      if (nextFase === "verificacion") {
        await supabase.from("enrichment_verifications").insert({
          job_id, propuesta: datosNuevos, decision: "pendiente",
        });
      }
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "action desconocida" }), {
    status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});