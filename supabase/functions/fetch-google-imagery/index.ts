import { corsHeaders, err, getServiceClient, getSetting, json, setProcessingStatus } from "../_shared/scoring_v2_common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);

  try {
    const body = await req.json().catch(() => ({}));
    if (body?.ping) {
      const API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
      if (!API_KEY) return json({ ok: false, reason: "no_key" });
      const r = await fetch(`https://maps.googleapis.com/maps/api/staticmap?center=Madrid&zoom=14&size=64x64&key=${API_KEY}`);
      return json({ ok: r.ok, status: r.status });
    }
    const { building_id } = body;
    if (!building_id) return err("building_id requerido", 400);

    const API_KEY = Deno.env.get("GOOGLE_MAPS_API_KEY");
    if (!API_KEY) {
      await setProcessingStatus(building_id, "google", "error", "GOOGLE_MAPS_API_KEY no configurada");
      return err("GOOGLE_MAPS_API_KEY no configurada en secrets", 400);
    }

    const sb = getServiceClient();
    await setProcessingStatus(building_id, "google", "running");

    const { data: cat } = await sb
      .from("catastro_data")
      .select("lat, lon, refcatastral")
      .eq("building_id", building_id)
      .maybeSingle();
    if (!cat?.lat || !cat?.lon) {
      await setProcessingStatus(building_id, "google", "error", "sin coordenadas; ejecuta Catastro primero");
      return err("Sin coordenadas. Ejecuta fetch-catastro-data primero", 400);
    }

    const center = `${cat.lat},${cat.lon}`;

    // -----------------------------------------------------------------
    // Street View: geocodificar la dirección → encontrar panorama más
    // cercano vía Metadata API → calcular heading que apunte al portal.
    // El centroide catastral suele caer en patio interior, y pasar la
    // dirección directamente a /streetview puede enganchar paneles de
    // calles paralelas con la cámara mirando al cielo o a un coche.
    // -----------------------------------------------------------------
    const { data: bldg } = await sb
      .from("buildings")
      .select("direccion, ciudad, codigo_postal")
      .eq("id", building_id)
      .maybeSingle();
    const addressParts = [bldg?.direccion, bldg?.codigo_postal, bldg?.ciudad, "España"]
      .filter(Boolean)
      .join(", ");

    // 1) Geocodificar — preferimos lat/lng del portal a lat/lng catastral
    let portalLat = cat.lat as number;
    let portalLng = cat.lon as number;
    if (addressParts) {
      try {
        const gRes = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(addressParts)}&region=es&key=${API_KEY}`,
        );
        const gJson = await gRes.json();
        const loc = gJson?.results?.[0]?.geometry?.location;
        if (loc?.lat && loc?.lng) {
          portalLat = loc.lat;
          portalLng = loc.lng;
        }
      } catch (e) {
        console.warn("geocode failed", e);
      }
    }

    // 2) Metadata API: panorama outdoor más cercano (radio 50m)
    let panoLat = portalLat;
    let panoLng = portalLng;
    let panoId: string | null = null;
    try {
      const mRes = await fetch(
        `https://maps.googleapis.com/maps/api/streetview/metadata?location=${portalLat},${portalLng}&radius=50&source=outdoor&key=${API_KEY}`,
      );
      const mJson = await mRes.json();
      if (mJson?.status === "OK" && mJson?.location?.lat && mJson?.location?.lng) {
        panoLat = mJson.location.lat;
        panoLng = mJson.location.lng;
        panoId = mJson.pano_id ?? null;
      }
    } catch (e) {
      console.warn("streetview metadata failed", e);
    }

    // 3) Heading desde el panorama hacia el portal
    const toRad = (d: number) => (d * Math.PI) / 180;
    const toDeg = (r: number) => (r * 180) / Math.PI;
    const φ1 = toRad(panoLat), φ2 = toRad(portalLat);
    const Δλ = toRad(portalLng - panoLng);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const headingToPortal = (toDeg(Math.atan2(y, x)) + 360) % 360;

    // Si pano y portal coinciden (raro), no podemos calcular un heading
    // útil; fallback a 0/90/180/270.
    const panoSameAsPortal =
      Math.abs(panoLat - portalLat) < 1e-6 && Math.abs(panoLng - portalLng) < 1e-6;

    // Identificador estable para llamar a la API: pano_id si lo tenemos,
    // si no las coords exactas del panorama (evita volver a "saltar").
    const svLocationParam = panoId
      ? `pano=${encodeURIComponent(panoId)}`
      : `location=${panoLat},${panoLng}`;

    // 4 fotos SIEMPRE mirando al portal del edificio.
    // Antes la 4ª usaba headingToPortal+180 ("acera de enfrente"), pero como
    // la cámara de SV normalmente está en la MISMA acera del portal, +180
    // capturaba el edificio de enfrente → fotos de OTRO edificio en la galería.
    // Ahora la 4ª es la misma dirección al portal con FOV más amplio (vista
    // completa) en vez de invertir el rumbo.
    const headings: number[] = panoSameAsPortal
      ? [0, 90, 180, 270]
      : [
          headingToPortal,
          (headingToPortal + 340) % 360, // -20º (lateral izq, posible 2ª fachada)
          (headingToPortal + 20) % 360,  // +20º (lateral der, posible 2ª fachada)
          headingToPortal,               // 4ª: misma dirección, FOV amplio (ver más abajo)
        ];

    const imagenes: any[] = [];
    const skipped: string[] = [];

    // Reemplazo limpio: borra filas previas de este building para no acumular
    // generaciones viejas (Street View cambia de panorama/heading entre runs).
    try {
      await sb.from("building_imagery").delete().eq("building_id", building_id);
    } catch (e) {
      console.warn("building_imagery prev delete failed", e);
    }

    const shots = [
      { source: "satellite", url: `https://maps.googleapis.com/maps/api/staticmap?center=${center}&zoom=20&size=640x640&maptype=satellite&key=${API_KEY}`, name: "satellite.png", heading: null, pitch: null, zoom: 20 },
      { source: "oblique",   url: `https://maps.googleapis.com/maps/api/staticmap?center=${center}&zoom=19&size=640x640&maptype=hybrid&key=${API_KEY}`,   name: "oblique.png",   heading: null, pitch: null, zoom: 19 },
      // 4 vistas oblicuas (z20) en rumbos 45/135/225/315 → cubren los 4 patios interiores desde ángulos
      // distintos para que el modelo cuente ventanas a patio directamente.
      { source: "oblique",   url: `https://maps.googleapis.com/maps/api/staticmap?center=${center}&zoom=20&size=640x640&maptype=hybrid&key=${API_KEY}`,   name: "oblique_45.png",  heading: 45,  pitch: null, zoom: 20 },
      { source: "oblique",   url: `https://maps.googleapis.com/maps/api/staticmap?center=${center}&zoom=20&size=640x640&maptype=hybrid&key=${API_KEY}`,   name: "oblique_135.png", heading: 135, pitch: null, zoom: 20 },
      { source: "oblique",   url: `https://maps.googleapis.com/maps/api/staticmap?center=${center}&zoom=20&size=640x640&maptype=hybrid&key=${API_KEY}`,   name: "oblique_225.png", heading: 225, pitch: null, zoom: 20 },
      { source: "oblique",   url: `https://maps.googleapis.com/maps/api/staticmap?center=${center}&zoom=20&size=640x640&maptype=hybrid&key=${API_KEY}`,   name: "oblique_315.png", heading: 315, pitch: null, zoom: 20 },
      ...headings.map((h, idx) => {
        const rounded = Math.round(h);
        // 4ª toma (idx 3): mismo rumbo al portal, FOV 110 + pitch 20 → vista
        // amplia del edificio completo sin invertir el heading. Para no colisionar
        // con la idx 0 (mismo rumbo, FOV 90) usamos un sufijo distinto en el nombre.
        const isWide = idx === 3;
        const fov = isWide ? 110 : 90;
        const pitch = isWide ? 20 : 30;
        const name = isWide ? `streetview_${rounded}_wide.png` : `streetview_${rounded}.png`;
        return {
          source: "streetview",
          url: `https://maps.googleapis.com/maps/api/streetview?size=640x640&${svLocationParam}&fov=${fov}&heading=${rounded}&pitch=${pitch}&source=outdoor&key=${API_KEY}`,
          name,
          heading: rounded,
          pitch,
          zoom: null as number | null,
        };
      }),
    ];

    for (const s of shots) {
      const r = await fetch(s.url);
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.byteLength < 5000) {
        const sniff = new TextDecoder().decode(buf).slice(0, 200);
        console.warn(`[imagery] skip ${s.name} status=${r.status} bytes=${buf.byteLength} body="${sniff}"`);
        skipped.push(s.name);
        continue;
      }
      const path = `${building_id}/${s.name}`;
      await sb.storage.from("building_imagery").upload(path, buf, {
        contentType: "image/png", upsert: true,
      });
      const public_url = sb.storage.from("building_imagery").getPublicUrl(path).data.publicUrl;
      const { error: upErr } = await sb.from("building_imagery").upsert({
        building_id,
        source: s.source,
        heading: s.heading,
        pitch: s.pitch,
        zoom: s.zoom,
        file_path: path,
        public_url,
        fetched_at: new Date().toISOString(),
      }, { onConflict: "building_id,file_path" } as any);
      if (upErr) console.error("imagery upsert error", upErr);
      imagenes.push({ source: s.source, public_url, bytes: buf.byteLength });
    }

    // ------------------------------------------------------------------
    // Aerial View API (mejor esfuerzo) — render 3D oblicuo tipo Google
    // Earth de la dirección. Si existe vídeo cacheado en estado ACTIVE,
    // descargamos el thumbnail; si no, disparamos render y seguimos.
    // ------------------------------------------------------------------
    let aerial_status: string | null = null;
    try {
      if (addressParts) {
        const lookupUrl = `https://aerialview.googleapis.com/v1/videos:lookupVideo?address=${encodeURIComponent(addressParts)}&key=${API_KEY}`;
        const lr = await fetch(lookupUrl);
        const lj = await lr.json().catch(() => ({}));
        aerial_status = lj?.state ?? lj?.error?.status ?? `http_${lr.status}`;
        const imageUri: string | undefined = lj?.uris?.image?.landscapeUri
          ?? lj?.uris?.IMAGE?.landscapeUri
          ?? lj?.uris?.thumbnail?.landscapeUri;
        if (lr.ok && lj?.state === "ACTIVE" && imageUri) {
          const ir = await fetch(imageUri);
          if (ir.ok) {
            const buf = new Uint8Array(await ir.arrayBuffer());
            if (buf.byteLength > 5000) {
              const path = `${building_id}/aerial_oblique.jpg`;
              await sb.storage.from("building_imagery").upload(path, buf, {
                contentType: "image/jpeg", upsert: true,
              });
              const public_url = sb.storage.from("building_imagery").getPublicUrl(path).data.publicUrl;
              await sb.from("building_imagery").upsert({
                building_id,
                source: "aerial",
                heading: null,
                pitch: null,
                zoom: null,
                file_path: path,
                public_url,
                fetched_at: new Date().toISOString(),
              }, { onConflict: "building_id,file_path" } as any);
              imagenes.push({ source: "aerial", public_url, bytes: buf.byteLength });
              aerial_status = "saved";
            }
          }
        } else if (lr.status === 404 || lj?.state === "PROCESSING" || lj?.error?.code === 404) {
          // Disparamos render para próximas ejecuciones (no bloquea).
          fetch(`https://aerialview.googleapis.com/v1/videos:renderVideo?key=${API_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address: addressParts }),
          }).catch(() => {});
          aerial_status = aerial_status ?? "render_triggered";
        }
      }
    } catch (e) {
      console.warn("aerial view skipped", e);
      aerial_status = `error:${String((e as Error).message ?? e).slice(0, 80)}`;
    }
    console.log(`[imagery] aerial_view status=${aerial_status}`);

    await setProcessingStatus(building_id, "google", "ok");
    return json({ imagenes, skipped, aerial_status });
  } catch (e) {
    console.error("fetch-google-imagery error", e);
    return err(String((e as Error).message ?? e));
  }
});