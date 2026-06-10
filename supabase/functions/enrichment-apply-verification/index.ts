// Aplica el resultado de la verificación humana T1-T10.
// Aprobar: upsert owners + building_owners + co-domicilios T8, avanza fase a hubspot.
// Rechazar: marca verificación rechazada, no escribe nada.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: claims } = await userClient.auth.getClaims(auth.replace("Bearer ", ""));
    if (!claims?.claims?.sub) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub;

    const body = await req.json();
    const { job_id, decision, overrides, motivo } = body ?? {};
    if (!job_id || !["aprobada", "rechazada"].includes(decision)) {
      return new Response(JSON.stringify({ error: "params" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: job, error: jobErr } = await supabase
      .from("enrichment_jobs").select("*").eq("id", job_id).maybeSingle();
    if (jobErr || !job) throw new Error("job no encontrado");

    if (decision === "rechazada") {
      await supabase.from("enrichment_verifications").insert({
        job_id, decision, motivo, aprobado_por: userId, aprobado_at: new Date().toISOString(),
        propuesta: overrides ?? job.datos,
      });
      await supabase.from("enrichment_jobs").update({
        estado: "descartado",
      }).eq("id", job_id);
      return new Response(JSON.stringify({ ok: true, action: "rechazada" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // APROBADA → upsert owner + building_owner + co-domicilios T8 + tarea Tecnofind
    const payload = overrides ?? {
      nombre: job.titular_nombre,
      nif: job.datos?.inglobaly?.nif ?? job.titular_nif,
      fecha_nacimiento: job.datos?.inglobaly?.fecha_nacimiento ?? null,
      domicilio: job.datos?.inglobaly?.domicilios?.[0]?.direccion ?? null,
      cargo: job.datos?.cargo ?? null,
      tipologia: job.datos?.tipologia ?? "T9",
      co_domicilios: job.datos?.inglobaly?.co_domicilios ?? [],
      pct: job.titular_pct,
    };

    // 1) Owner principal
    const ownerNombre = payload.nombre?.trim();
    let ownerId: string | null = null;
    if (ownerNombre) {
      const { data: existing } = await supabase
        .from("owners").select("id").ilike("nombre", ownerNombre).maybeSingle();
      if (existing) {
        ownerId = existing.id;
        await supabase.from("owners").update({
          metadatos: {
            nif: payload.nif, fecha_nacimiento: payload.fecha_nacimiento,
            domicilio: payload.domicilio, tipologia: payload.tipologia,
            cargo: payload.cargo, fuente: "enrichment",
          },
        }).eq("id", ownerId);
      } else {
        const { data: ins } = await supabase.from("owners").insert({
          nombre: ownerNombre,
          metadatos: {
            nif: payload.nif, fecha_nacimiento: payload.fecha_nacimiento,
            domicilio: payload.domicilio, tipologia: payload.tipologia,
            cargo: payload.cargo, fuente: "enrichment",
          },
        }).select("id").maybeSingle();
        ownerId = ins?.id ?? null;
      }
    }

    // 2) building_owners
    if (ownerId && job.building_id) {
      await supabase.from("building_owners").upsert({
        building_id: job.building_id, owner_id: ownerId,
        porcentaje_propiedad: payload.pct ?? null,
        rol_notas: payload.cargo ?? null,
      }, { onConflict: "building_id,owner_id" });
    }

    // 3) Co-domicilios → contactos T8 sin confirmar
    let coCount = 0;
    for (const co of (payload.co_domicilios ?? [])) {
      const cname = (co.nombre || "").trim();
      if (!cname) continue;
      const { data: ex } = await supabase
        .from("owners").select("id").ilike("nombre", cname).maybeSingle();
      let cid = ex?.id;
      if (!cid) {
        const { data: ins } = await supabase.from("owners").insert({
          nombre: cname,
          metadatos: {
            nif: co.nif, tipologia: "T8",
            subrole: "co_domicilio_sin_confirmar",
            co_domicilio_origen: job.id,
            fuente: "enrichment",
          },
        }).select("id").maybeSingle();
        cid = ins?.id;
      }
      if (cid && job.building_id) {
        await supabase.from("building_owners").upsert({
          building_id: job.building_id, owner_id: cid,
          rol_notas: "co_domicilio_sin_confirmar",
        }, { onConflict: "building_id,owner_id" });
        coCount++;
      }
    }

    // 4) Tarea Tecnofind si falta teléfono
    if (job.building_id && !payload.telefono) {
      await supabase.from("building_tasks").insert({
        building_id: job.building_id,
        titulo: `Buscar teléfono en Tecnofind — ${ownerNombre}`,
        tipo: "investigacion",
        estado: "pendiente",
        metadatos: { owner_id: ownerId, enrichment_job_id: job.id },
      });
    }

    // 5) Registrar verificación
    await supabase.from("enrichment_verifications").insert({
      job_id, decision: "aprobada", aprobado_por: userId,
      aprobado_at: new Date().toISOString(), propuesta: payload,
    });

    // 6) Avanzar a fase hubspot
    await supabase.from("enrichment_jobs").update({
      fase: "hubspot", estado: "ok",
      datos: { ...job.datos, aplicado: { owner_id: ownerId, co_domicilios: coCount } },
    }).eq("id", job_id);

    return new Response(JSON.stringify({
      ok: true, action: "aprobada", owner_id: ownerId, co_domicilios: coCount,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});