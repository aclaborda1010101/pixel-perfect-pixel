import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { detectStreetEdges } from "../_shared/parcel_geometry.ts";
import { detectCornerCatastro } from "../_shared/corner_catastro.ts";

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
  const batchSize: number = Number.isFinite(body.batch_size) ? Math.max(1, Math.min(50, Number(body.batch_size))) : 10;
  const chainMode: boolean = body.chain === true;
  const reset: boolean = body.reset === true;
  const partialKey = "corner_recompute_partial";

  // Estado parcial (cursor + agregados)
  const { data: prev } = reset ? { data: null } as any
    : await sb.from("app_settings").select("value").eq("key", partialKey).maybeSingle();
  const state: any = (prev?.value as any) ?? {
    started_at: new Date().toISOString(),
    processed_refs: [] as string[],
    changes: [] as any[],
    counts: { total: 0, new_corner: 0, lost_corner: 0, chaflan: 0, multifachada: 0, angulo: 0, linea: 0, errors: 0 },
    before: { corners: 0, no_corner: 0 },
    after: { corners: 0, no_corner: 0 },
  };
  const doneSet = new Set<string>(state.processed_refs ?? []);

  let q = sb.from("parcel_geometry_cache").select(
    "refcatastral_14, exterior_ring, centroid, is_corner, corner_type, source",
  ).order("refcatastral_14");
  if (onlyRefs) q = q.in("refcatastral_14", onlyRefs);
  const { data: allParcels, error: pErr } = await q;
  if (pErr) {
    return new Response(JSON.stringify({ error: pErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const totalAll = allParcels?.length ?? 0;
  const pending = (allParcels ?? []).filter((p) => !doneSet.has(p.refcatastral_14));
  const parcels = pending.slice(0, batchSize);

  const changes: any[] = state.changes;
  const counts = state.counts;
  const before = state.before;
  const after = state.after;

  const run = async () => {
    for (const p of parcels) {
      counts.total++;
      if (p.is_corner === true) before.corners++; else before.no_corner++;
      try {
        if (!Array.isArray(p.exterior_ring) || p.exterior_ring.length < 4) { doneSet.add(p.refcatastral_14); continue; }
        const cen = p.centroid as { lat: number; lon: number } | null;
        if (!cen?.lat || !cen?.lon) { doneSet.add(p.refcatastral_14); continue; }
        // skipGoogle: false → si Overpass falla en una arista, intenta Google Roads (nearestRoads + reverse geocode) como fallback de callejero.
        const det = await detectStreetEdges(p.exterior_ring as [number, number][], { lat: cen.lat, lon: cen.lon, skipGoogle: false });
        // Detector GEOMÉTRICO catastral (medianera/patio/calle) = PRIMARIO para la decisión de esquina.
        // detectStreetEdges (conteo de nombres OSM) queda solo para metadatos de frentes/nombres.
        // Validado ~97% sobre verdad de campo bajo criterio "fachadas de parcela".
        const geo = await detectCornerCatastro(cen.lat, cen.lon, Deno.env.get("GOOGLE_MAPS_API_KEY"));
        const isCorner = geo ? geo.is_corner : det.is_corner;
        const needsReview = geo ? geo.needs_review : (det.is_corner ? (det.esquina_needs_review ?? false) : false);
        const newType = geo ? geo.corner_type : (det.corner_type ?? "linea");
        if (newType === "esquina_chaflan") counts.chaflan++;
        else if (newType === "multifachada") counts.multifachada++;
        else if (newType === "esquina_angulo") counts.angulo++;
        else counts.linea++;
        if (isCorner) after.corners++; else after.no_corner++;

        const changedCorner = (p.is_corner ?? false) !== isCorner;
        const changedType = (p.corner_type ?? null) !== newType;

        const rcLike = `${p.refcatastral_14}%`;
        const { data: bs } = await sb
          .from("buildings")
          .select("id, direccion")
          .or(`refcatastral.ilike.${rcLike},catastro_ref.ilike.${rcLike}`)
          .limit(1);
        const b = bs?.[0];

        if (changedCorner) {
          if (isCorner) counts.new_corner++; else counts.lost_corner++;
        }

        if (changedCorner || changedType) {
          changes.push({
            rc14: p.refcatastral_14,
            direccion: b?.direccion ?? null,
            building_id: b?.id ?? null,
            old_is_corner: p.is_corner ?? null,
            new_is_corner: isCorner,
            old_corner_type: p.corner_type ?? null,
            new_corner_type: newType,
            needs_review: needsReview,
            geom: geo ? { street_fronts: geo.street_fronts, max_turn_deg: geo.max_turn_deg, n_calle: geo.n_calle, n_patio: geo.n_patio, n_open: geo.n_open, neighbors: geo.neighbors } : null,
            street_names: det.street_names_distinct ?? [],
            frentes_count: det.frentes?.length ?? 0,
            frentes: (det.frentes ?? []).map((f) => ({ vial: f.vial, longitud_m: f.longitud_m })),
          });
        }

        if (!dryRun) {
          await sb.from("parcel_geometry_cache").update({
            street_edges_jsonb: det.street_edges,
            is_corner: isCorner,
            total_street_length_m: det.total_street_length_m,
            corner_type: newType,
            street_names_distinct: det.street_names_distinct ?? [],
            frentes_jsonb: det.frentes ?? [],
          }).eq("refcatastral_14", p.refcatastral_14);

          // Propagar resultado del detector a building_analysis.esquina (NO a qa_ground_truth)
          // [#7] Adjuntamos esquina_needs_review cuando la esquina se apoya en una señal débil.
          if (b?.id) {
            await sb.from("building_analysis").update({
              esquina: isCorner,
              esquina_needs_review: needsReview,
            }).eq("building_id", b.id);
          }

          if (changedCorner && b?.id) {
            await sb.from("building_feedback").insert({
              building_id: b.id,
              canal: "sistema",
              autor_email: "corner-detector@affluxos",
              dimension: "esquina",
              estado: "abierto",
              texto: `Detector de esquina v4 (geometría catastral): ${p.is_corner ? "esquina" : "no_esquina"} → ${isCorner ? "esquina" : "no_esquina"} (${newType})${needsReview ? " [A REVISAR]" : ""}. ${geo ? `Frentes calle=${geo.n_calle} patio=${geo.n_patio} abierto=${geo.n_open} giro=${geo.max_turn_deg}° vecinos=${geo.neighbors}` : "geom no disponible"}. Por favor confirma por la UI.`,
              analisis_ia: {
                old_is_corner: p.is_corner,
                new_is_corner: isCorner,
                old_corner_type: p.corner_type,
                new_corner_type: newType,
                needs_review: needsReview,
                geom: geo,
                street_names_distinct: det.street_names_distinct ?? [],
                frentes: det.frentes ?? [],
                corner_angle_deg: det.corner_angle_deg,
                refcatastral_14: p.refcatastral_14,
                detector_version: "v4_catastro_geom",
              },
            });
          }
        }
        doneSet.add(p.refcatastral_14);
        // Persistir parcial DESPUÉS DE CADA EDIFICIO (no esperar al fin de lote: los timeouts se comen el batch entero)
        state.processed_refs = Array.from(doneSet);
        state.changes = changes; state.counts = counts; state.before = before; state.after = after;
        state.progress = `${state.processed_refs.length}/${totalAll}`;
        state.last_building_at = new Date().toISOString();
        await sb.from("app_settings").upsert({ key: partialKey, value: state as any, updated_at: new Date().toISOString() }, { onConflict: "key" });
        // Espaciado entre edificios para no martillear Overpass
        await new Promise((r) => setTimeout(r, 1200));
      } catch (e) {
        counts.errors++;
        console.warn(`recompute error ${p.refcatastral_14}: ${(e as Error).message}`);
        doneSet.add(p.refcatastral_14);
      }
    }

    // Persistencia final del lote (idempotente con la de cada edificio)
    state.processed_refs = Array.from(doneSet);
    state.changes = changes;
    state.counts = counts;
    state.before = before;
    state.after = after;
    state.progress = `${state.processed_refs.length}/${totalAll}`;
    state.last_batch_at = new Date().toISOString();
    await sb.from("app_settings").upsert({
      key: partialKey, value: state as any, updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    const finished = state.processed_refs.length >= totalAll;
    if (finished) {
      await sb.from("app_settings").upsert({
        key: "corner_recompute_last",
        value: { ...state, finished_at: new Date().toISOString() } as any,
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
    } else if (chainMode) {
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/recompute-corner-detection`;
      const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${srk}`, apikey: srk },
        body: JSON.stringify({ async: true, chain: true, batch_size: batchSize, dry_run: dryRun }),
      }).catch(() => {});
    }
  };

  if (asyncMode) {
    // @ts-ignore EdgeRuntime API
    EdgeRuntime.waitUntil(run().then(() => console.log("recompute-corner batch done", JSON.stringify({ counts, before, after }))));
    return new Response(JSON.stringify({
      ok: true, async: true, chain: chainMode,
      queued: parcels.length,
      done_before: doneSet.size,
      total: totalAll,
      remaining_before: pending.length,
    }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  await run();

  const refsToCheck = ["9839518VK3793H", "0382201VK4708C"];
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

  return new Response(JSON.stringify({ ok: true, dryRun, counts, before, after, verifications, changes, progress: state.progress }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});