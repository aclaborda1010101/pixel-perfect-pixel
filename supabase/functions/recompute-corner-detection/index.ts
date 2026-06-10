import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { detectStreetEdges } from "../_shared/parcel_geometry.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* GET */ }
  const dryRun: boolean = body.dry_run === true;
  const onlyRefs: string[] | null = Array.isArray(body.refcatastrales) ? body.refcatastrales : null;
  const asyncMode: boolean = body.async === true;
  const limit: number = Number.isFinite(body.limit) ? Math.max(1, Math.min(200, Number(body.limit))) : 200;
  const offset: number = Number.isFinite(body.offset) ? Math.max(0, Number(body.offset)) : 0;

  // Carga todas las parcelas cacheadas (74 en cartera actual).
  let q = sb.from("parcel_geometry_cache").select(
    "refcatastral_14, exterior_ring, centroid, is_corner, corner_type, source",
  ).order("refcatastral_14").range(offset, offset + limit - 1);
  if (onlyRefs) q = q.in("refcatastral_14", onlyRefs);
  const { data: parcels, error: pErr } = await q;
  if (pErr) {
    return new Response(JSON.stringify({ error: pErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const changes: Array<{
    rc14: string;
    direccion?: string | null;
    building_id?: string | null;
    old_is_corner: boolean | null;
    new_is_corner: boolean;
    old_corner_type: string | null;
    new_corner_type: string;
    street_names: string[];
    frentes_count: number;
    frentes: Array<{ vial: string; longitud_m: number }>;
  }> = [];

  const counts = { total: 0, new_corner: 0, lost_corner: 0, chaflan: 0, multifachada: 0, angulo: 0, linea: 0, errors: 0 };
  const before = { corners: 0, no_corner: 0 };
  const after = { corners: 0, no_corner: 0 };

  const run = async () => {
   for (const p of parcels ?? []) {
    counts.total++;
    if (p.is_corner === true) before.corners++; else before.no_corner++;
    try {
      if (!Array.isArray(p.exterior_ring) || p.exterior_ring.length < 4) continue;
      const cen = p.centroid as { lat: number; lon: number } | null;
      if (!cen?.lat || !cen?.lon) continue;
      const det = await detectStreetEdges(p.exterior_ring as [number, number][], { lat: cen.lat, lon: cen.lon, skipGoogle: true });
      const newType = det.corner_type ?? "linea";
      if (newType === "esquina_chaflan") counts.chaflan++;
      else if (newType === "multifachada") counts.multifachada++;
      else if (newType === "esquina_angulo") counts.angulo++;
      else counts.linea++;
      if (det.is_corner) after.corners++; else after.no_corner++;

      const changedCorner = (p.is_corner ?? false) !== det.is_corner;
      const changedType = (p.corner_type ?? null) !== newType;

      // Resolver building por prefijo rc14 (en la BD el ref tiene 20 chars).
      const rcLike = `${p.refcatastral_14}%`;
      const { data: bs } = await sb
        .from("buildings")
        .select("id, direccion")
        .or(`refcatastral.ilike.${rcLike},catastro_ref.ilike.${rcLike}`)
        .limit(1);
      const b = bs?.[0];

      if (changedCorner) {
        if (det.is_corner) counts.new_corner++; else counts.lost_corner++;
      }

      if (changedCorner || changedType) {
        changes.push({
          rc14: p.refcatastral_14,
          direccion: b?.direccion ?? null,
          building_id: b?.id ?? null,
          old_is_corner: p.is_corner ?? null,
          new_is_corner: det.is_corner,
          old_corner_type: p.corner_type ?? null,
          new_corner_type: newType,
          street_names: det.street_names_distinct ?? [],
          frentes_count: det.frentes?.length ?? 0,
          frentes: (det.frentes ?? []).map((f) => ({ vial: f.vial, longitud_m: f.longitud_m })),
        });
      }

      if (!dryRun) {
        await sb.from("parcel_geometry_cache").update({
          street_edges_jsonb: det.street_edges,
          is_corner: det.is_corner,
          total_street_length_m: det.total_street_length_m,
          corner_type: newType,
          street_names_distinct: det.street_names_distinct ?? [],
          frentes_jsonb: det.frentes ?? [],
        }).eq("refcatastral_14", p.refcatastral_14);

        if (changedCorner && b?.id) {
          await sb.from("building_feedback").insert({
            building_id: b.id,
            canal: "sistema",
            autor_email: "corner-detector@affluxos",
            dimension: "esquina",
            estado: "abierto",
            texto: `Detector de esquina v3 (por viales): ${p.is_corner ? "esquina" : "no_esquina"} → ${det.is_corner ? "esquina" : "no_esquina"} (${newType}). Frentes: ${(det.frentes ?? []).map((f) => `${f.vial} (${f.longitud_m}m)`).join(" | ") || "—"}.`,
            analisis_ia: {
              old_is_corner: p.is_corner,
              new_is_corner: det.is_corner,
              old_corner_type: p.corner_type,
              new_corner_type: newType,
              street_names_distinct: det.street_names_distinct ?? [],
              frentes: det.frentes ?? [],
              corner_angle_deg: det.corner_angle_deg,
              refcatastral_14: p.refcatastral_14,
              detector_version: "v3_by_street_names",
            },
          });

          // Upsert qa_ground_truth.es_esquina — solo si no hay verificación humana
          if (b?.id) {
            const { data: gtRow } = await sb
              .from("qa_ground_truth")
              .select("id, verificado_por")
              .eq("building_id", b.id)
              .maybeSingle();
            const isHumanVerified = gtRow?.verificado_por && gtRow.verificado_por !== "corner_detector_v3";
            if (!isHumanVerified) {
              if (gtRow?.id) {
                await sb.from("qa_ground_truth").update({
                  es_esquina: det.is_corner,
                  fuente_verificacion: "corner_detector_v3",
                  verificado_at: new Date().toISOString(),
                }).eq("id", gtRow.id);
              } else {
                await sb.from("qa_ground_truth").insert({
                  building_id: b.id,
                  es_esquina: det.is_corner,
                  fuente_verificacion: "corner_detector_v3",
                  verificado_at: new Date().toISOString(),
                });
              }
            }
          }
        }
      }
    } catch (e) {
      counts.errors++;
      console.warn(`recompute error ${p.refcatastral_14}: ${(e as Error).message}`);
    }
   }
  };

  if (asyncMode) {
    // @ts-ignore EdgeRuntime API
    EdgeRuntime.waitUntil(run().then(() => console.log("recompute-corner done", JSON.stringify({ counts, before, after, changes }))));
    return new Response(JSON.stringify({ ok: true, async: true, queued: parcels?.length ?? 0 }), {
      status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  await run();

  // Verificaciones explícitas requeridas por el caso de aceptación
  const refsToCheck = ["9839518VK3793H", "0382201VK4708C"]; // Cava Baja 42, Topete 33
  const verifications: any[] = [];
  for (const ref of refsToCheck) {
    const { data: pgc } = await sb
      .from("parcel_geometry_cache")
      .select("refcatastral_14, is_corner, corner_type, street_names_distinct, frentes_jsonb")
      .ilike("refcatastral_14", `${ref}%`)
      .limit(1)
      .maybeSingle();
    verifications.push({ ref, result: pgc });
  }

  return new Response(JSON.stringify({ ok: true, dryRun, counts, before, after, verifications, changes }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});