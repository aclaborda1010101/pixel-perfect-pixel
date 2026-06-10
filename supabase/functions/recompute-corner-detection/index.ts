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
  }> = [];

  const counts = { total: 0, new_corner: 0, lost_corner: 0, chaflan: 0, multifachada: 0, angulo: 0, linea: 0, errors: 0 };

  for (const p of parcels ?? []) {
    counts.total++;
    try {
      if (!Array.isArray(p.exterior_ring) || p.exterior_ring.length < 4) continue;
      const cen = p.centroid as { lat: number; lon: number } | null;
      if (!cen?.lat || !cen?.lon) continue;
      const det = await detectStreetEdges(p.exterior_ring as [number, number][], { lat: cen.lat, lon: cen.lon });
      const newType = det.corner_type ?? "linea";
      if (newType === "esquina_chaflan") counts.chaflan++;
      else if (newType === "multifachada") counts.multifachada++;
      else if (newType === "esquina_angulo") counts.angulo++;
      else counts.linea++;

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
        });
      }

      if (!dryRun) {
        await sb.from("parcel_geometry_cache").update({
          street_edges_jsonb: det.street_edges,
          is_corner: det.is_corner,
          total_street_length_m: det.total_street_length_m,
          corner_type: newType,
          street_names_distinct: det.street_names_distinct ?? [],
        }).eq("refcatastral_14", p.refcatastral_14);

        if (changedCorner && b?.id) {
          await sb.from("building_feedback").insert({
            building_id: b.id,
            canal: "sistema",
            autor_email: "corner-detector@affluxos",
            dimension: "esquina",
            estado: "abierto",
            texto: `Detector de esquina v2: ${p.is_corner ? "esquina" : "no_esquina"} → ${det.is_corner ? "esquina" : "no_esquina"} (${newType}). Viales detectados: ${(det.street_names_distinct ?? []).join(" | ") || "—"}.`,
            analisis_ia: {
              old_is_corner: p.is_corner,
              new_is_corner: det.is_corner,
              old_corner_type: p.corner_type,
              new_corner_type: newType,
              street_names_distinct: det.street_names_distinct ?? [],
              corner_angle_deg: det.corner_angle_deg,
              refcatastral_14: p.refcatastral_14,
            },
          });
        }
      }
    } catch (e) {
      counts.errors++;
      console.warn(`recompute error ${p.refcatastral_14}: ${(e as Error).message}`);
    }
  }

  return new Response(JSON.stringify({ ok: true, dryRun, counts, changes }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});