// link_notas_simples — vincula notas_simples (status=listo) con owners/companies/buildings
// Idempotente. POST { nota_id?: uuid, limit?: number, dry_run?: boolean }
// - Parsea structured_json.titulares[]
// - Para cada titular: match owners (DNI) o companies (CIF); si no existe, crea (source=nota_simple)
// - Inserta nota_simple_titulares (idempotente por nota+owner/company+rol)
// - Matchea building por finca.ref_catastral (buildings.catastro_ref) o dirección
// - Si match y nota.building_id NULL, actualiza
// - Crea/actualiza building_owners (particulares) y building_companies (empresas)
// - Detecta 'heredero/a de' y 'representante de' en raw_pdf_text -> owner_relations
// - Reporta counts

import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type Titular = {
  nombre?: string;
  cif_dni?: string;
  porcentaje?: number | string | null;
  rol?: string | null;
};

const normDoc = (s?: string | null) =>
  (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
const normName = (s?: string | null) =>
  (s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
const isCompanyDoc = (d: string) => /^[A-HJ-NP-SUVW]\d{7}[0-9A-J]$/.test(d) || d.startsWith("ES") || d.length === 9 && /^[ABCDEFGHJ]/.test(d);
const looksLikeCompany = (name: string) => /\b(S\.?L\.?U?|S\.?A\.?U?|SOCIEDAD|COMPAÑIA|COMPANIA|COMPAÑÍA|CIA|LTDA|INC|CORP|SCA|SC|COOP|SCP|AIE|UTE)\b/i.test(name);

function mapRol(r?: string | null): string {
  const v = (r ?? "").toLowerCase().trim();
  if (v.includes("usufructo") && v.includes("nuda")) return "pleno";
  if (v === "usufructo" || v.includes("usufructo")) return "usufructo";
  if (v.includes("nuda")) return "nuda_propiedad";
  if (v === "pleno" || v.includes("pleno")) return "pleno";
  return "otro";
}

// Extrae una dirección legible del texto `linderos` o de structured_json.
// Devuelve { direccion, ciudad } o null si no consigue extraer nada útil.
function extractAddress(sj: any): { direccion: string; ciudad: string | null } | null {
  // 1. Campos directos
  const direct = (sj?.direccion || sj?.finca?.direccion || "").toString().trim();
  if (direct.length > 8) {
    return { direccion: direct, ciudad: sj?.ciudad ?? sj?.finca?.ciudad ?? null };
  }
  // 2. Parsear linderos: "Casa en la calle de la Abada, de Madrid, número cuatro"
  const linderos = (sj?.linderos ?? "").toString();
  if (!linderos) return null;
  // Buscar patrón "(calle|plaza|paseo|avenida|...) <nombre>"
  const re = /\b(calle|c\/|plaza|pza\.?|paseo|p[ºo°]\.?|avenida|av\.?|ronda|travesía|carretera|ctra\.?|camino|via)\s+(?:de\s+(?:la|los|las|el)\s+|de\s+|del\s+)?([A-Za-zÀ-ÿñÑ][A-Za-zÀ-ÿñÑ0-9\s\.\-']{3,60}?)(?=,|\s+n[úu]mero|\s+n[ºo°\.]|\.|;|\s+de\s+(?:Madrid|Barcelona|[A-Z]))/i;
  const m = linderos.match(re);
  if (!m) return null;
  const tipo = m[1].toLowerCase().replace(/\.?$/, "");
  const tipoFmt = tipo.startsWith("c/") || tipo === "calle" ? "Calle"
    : tipo.startsWith("pza") || tipo === "plaza" ? "Plaza"
    : tipo.startsWith("p") && tipo.includes("seo") ? "Paseo"
    : tipo.startsWith("av") ? "Avenida"
    : tipo.startsWith("ctra") ? "Carretera"
    : tipo.charAt(0).toUpperCase() + tipo.slice(1);
  const nombre = m[2].trim().replace(/\s+/g, " ");
  // Detectar ciudad en el linderos
  const ciudadMatch = linderos.match(/de\s+(Madrid|Barcelona|Valencia|Sevilla|Bilbao|Málaga|Zaragoza|[A-ZÁÉÍÓÚ][a-záéíóúñ]+)/);
  const ciudad = ciudadMatch ? ciudadMatch[1] : null;
  // Detectar número
  const numMatch = linderos.match(/n[úu]mero\s+([\w\d]+)/i) || linderos.match(/,?\s*(\d{1,4})\b/);
  const numero = numMatch ? numMatch[1] : "";
  // Convertir números escritos a dígito si vienen como palabra (cuatro->4)
  const palabrasNum: Record<string, string> = {
    uno: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8", nueve: "9", diez: "10",
    once: "11", doce: "12", trece: "13", catorce: "14", quince: "15", veinte: "20",
  };
  const numFinal = palabrasNum[numero.toLowerCase()] ?? numero;
  const direccion = `${tipoFmt} ${nombre}${numFinal ? " " + numFinal : ""}`.trim();
  return { direccion, ciudad };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const nota_id: string | undefined = body.nota_id;
  const limit: number = Math.min(Number(body.limit ?? 500), 2000);
  const dryRun: boolean = !!body.dry_run;

  // Fetch notas
  let q = sb.from("notas_simples")
    .select("id, building_id, structured_json, raw_pdf_text")
    .eq("status", "listo")
    .not("structured_json", "is", null);
  if (nota_id) q = q.eq("id", nota_id);
  else q = q.limit(limit);

  const { data: notas, error: notasErr } = await q;
  if (notasErr) {
    return new Response(JSON.stringify({ error: notasErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const stats = {
    notas_processed: 0,
    owners_created: 0,
    companies_created: 0,
    titulares_inserted: 0,
    building_owners_upserted: 0,
    building_companies_upserted: 0,
    owner_relations_detected: 0,
    notas_linked_to_building: 0,
    building_match_catastro: 0,
    building_match_fuzzy: 0,
    building_created_auto: 0,
    building_no_match: 0,
    errors: [] as Array<{ nota_id: string; error: string }>,
  };

  for (const nota of notas ?? []) {
    try {
      const sj = (nota.structured_json ?? {}) as any;
      const titulares: Titular[] = Array.isArray(sj.titulares) ? sj.titulares : [];
      const finca = sj.finca ?? {};
      const refCat = normDoc(finca.ref_catastral);

      // 1) Match / asegurar building (catastro → fuzzy direccion → auto-crear)
      let buildingId: string | null = nota.building_id ?? null;
      let matchKind: "existing_catastro" | "existing_fuzzy" | "auto_created" | "none" = "none";

      // 1a) Catastro normalizado (ambos lados)
      if (!buildingId && refCat) {
        // Comparar normalizando ambos lados vía SQL function (usa el índice funcional)
        const { data: b } = await sb.rpc("normalize_catastro", { p: refCat }).then(async (r: any) => {
          const normRef = r?.data ?? refCat;
          return await sb.from("buildings")
            .select("id")
            .filter("catastro_ref", "not.is", null)
            // Búsqueda por igualdad con el normalizado vía sql expression: imposible desde el SDK,
            // así que usamos un OR ilike sobre la versión con y sin formato.
            .or(`catastro_ref.eq.${normRef},catastro_ref.eq.${refCat}`)
            .limit(1).maybeSingle();
        }).catch(() => ({ data: null }));
        if (b?.id) {
          buildingId = b.id;
          matchKind = "existing_catastro";
          stats.building_match_catastro++;
        }
      }

      // 1a-bis) Fallback: si el catastro de la nota viene con espacios y no se ha encontrado, probamos en bruto
      if (!buildingId && refCat) {
        // Buscamos en BD con normalize_catastro(catastro_ref) = refCat via vista no disponible;
        // así que cargamos buildings cuya cat empiece igual sin formateo.
        const prefix = refCat.slice(0, 7);
        const { data: cands } = await sb.from("buildings")
          .select("id, catastro_ref")
          .ilike("catastro_ref", `%${prefix}%`)
          .limit(20);
        const hit = (cands ?? []).find((c: any) => normDoc(c.catastro_ref) === refCat);
        if (hit) {
          buildingId = hit.id;
          matchKind = "existing_catastro";
          stats.building_match_catastro++;
        }
      }

      // 1b) Fuzzy match por dirección extraída
      const extracted = extractAddress(sj);
      if (!buildingId && extracted) {
        const { data: fid } = await sb.rpc("match_building_fuzzy", {
          p_direccion: extracted.direccion,
          p_ciudad: extracted.ciudad,
          p_threshold: 0.4,
        });
        if (fid) {
          buildingId = fid as unknown as string;
          matchKind = "existing_fuzzy";
          stats.building_match_fuzzy++;
        }
      }

      // 1c) Auto-crear building si no hay match
      if (!buildingId && !dryRun && (extracted || refCat)) {
        const direccionFinal = extracted?.direccion || `[Sin dirección] ${refCat ?? "ref desconocida"}`;
        const ciudadFinal = extracted?.ciudad || "Desconocida";
        const { data: created, error: cErr } = await sb.from("buildings").insert({
          direccion: direccionFinal,
          ciudad: ciudadFinal,
          catastro_ref: refCat || null,
          estado: "identificado",
          metadatos: {
            source: "nota_simple_auto",
            nota_simple_id: nota.id,
            sync_to_hubspot: false,
            linderos_excerpt: (sj.linderos ?? "").toString().slice(0, 240),
          },
        }).select("id").single();
        if (cErr) throw new Error(`buildings auto-insert: ${cErr.message}`);
        buildingId = created!.id;
        matchKind = "auto_created";
        stats.building_created_auto++;
      }

      if (!buildingId) {
        stats.building_no_match++;
      }

      if (buildingId && !nota.building_id && !dryRun) {
        await sb.from("notas_simples").update({ building_id: buildingId }).eq("id", nota.id);
        stats.notas_linked_to_building++;
      }

      // 2) Procesar titulares
      type Resolved = { kind: "owner" | "company"; id: string; nombre: string; rol: string; porcentaje: number | null };
      const resolved: Resolved[] = [];

      for (const t of titulares) {
        const nombre = normName(t.nombre);
        if (!nombre) continue;
        const doc = normDoc(t.cif_dni);
        const isCompany = (doc && isCompanyDoc(doc)) || looksLikeCompany(nombre);
        const porc = t.porcentaje == null ? null : Number(String(t.porcentaje).replace(",", ".")) || null;
        const rol = mapRol(t.rol);

        let resolvedId: string | null = null;
        let createdNew = false;

        if (isCompany) {
          // match by CIF in companies.cif or metadatos->>cif, then by nombre
          if (doc) {
            const { data } = await sb.from("companies")
              .select("id")
              .or(`cif.eq.${doc},metadatos->>cif.eq.${doc}`)
              .limit(1).maybeSingle();
            if (data?.id) resolvedId = data.id;
          }
          if (!resolvedId) {
            const { data } = await sb.from("companies")
              .select("id").ilike("nombre", nombre).limit(1).maybeSingle();
            if (data?.id) resolvedId = data.id;
          }
          if (!resolvedId && !dryRun) {
            const { data, error } = await sb.from("companies").insert({
              nombre,
              cif: doc || null,
              metadatos: { source: "nota_simple", nota_simple_id: nota.id, cif: doc || null },
            }).select("id").single();
            if (error) throw new Error(`companies insert: ${error.message}`);
            resolvedId = data!.id;
            createdNew = true;
            stats.companies_created++;
          }
          if (resolvedId) resolved.push({ kind: "company", id: resolvedId, nombre, rol, porcentaje: porc });
        } else {
          if (doc) {
            const { data } = await sb.from("owners")
              .select("id")
              .or(`metadatos->>dni.eq.${doc},metadatos->>nif.eq.${doc}`)
              .limit(1).maybeSingle();
            if (data?.id) resolvedId = data.id;
          }
          if (!resolvedId) {
            const { data } = await sb.from("owners")
              .select("id").ilike("nombre", nombre).limit(1).maybeSingle();
            if (data?.id) resolvedId = data.id;
          }
          if (!resolvedId && !dryRun) {
            const { data, error } = await sb.from("owners").insert({
              nombre,
              metadatos: { source: "nota_simple", nota_simple_id: nota.id, dni: doc || null },
            }).select("id").single();
            if (error) throw new Error(`owners insert: ${error.message}`);
            resolvedId = data!.id;
            createdNew = true;
            stats.owners_created++;
          }
          if (resolvedId) resolved.push({ kind: "owner", id: resolvedId, nombre, rol, porcentaje: porc });
        }

        // 3) Insertar nota_simple_titulares (idempotente: por nota + owner_id/company_id + rol)
        if (resolvedId && !dryRun) {
          const filter: any = { nota_simple_id: nota.id, rol };
          if (isCompany) filter.company_id = resolvedId; else filter.owner_id = resolvedId;
          let existsQ = sb.from("nota_simple_titulares")
            .select("id")
            .eq("nota_simple_id", nota.id)
            .eq("rol", rol);
          existsQ = isCompany
            ? existsQ.eq("company_id", resolvedId)
            : existsQ.eq("owner_id", resolvedId);
          const { data: existing } = await existsQ.limit(1).maybeSingle();
          if (!existing) {
            const { error } = await sb.from("nota_simple_titulares").insert({
              nota_simple_id: nota.id,
              owner_id: isCompany ? null : resolvedId,
              company_id: isCompany ? resolvedId : null,
              nombre_extraido: nombre,
              cif_dni: doc || null,
              porcentaje: porc,
              rol,
            });
            if (error) throw new Error(`titulares insert: ${error.message}`);
            stats.titulares_inserted++;
          }
        }
      }

      // 4) Vincular a building (idempotente)
      if (buildingId && !dryRun) {
        for (const r of resolved) {
          if (r.kind === "owner") {
            const { data: ex } = await sb.from("building_owners")
              .select("owner_id").eq("building_id", buildingId).eq("owner_id", r.id).maybeSingle();
            if (!ex) {
              const subrole = r.rol === "usufructo" ? "usufructuario"
                : r.rol === "nuda_propiedad" ? "nudo_propietario"
                : "ninguno";
              const { error } = await sb.from("building_owners").insert({
                building_id: buildingId,
                owner_id: r.id,
                subrole,
                cuota: r.porcentaje,
                rol_notas: r.rol,
                metadatos: { source: "nota_simple", nota_simple_id: nota.id },
              });
              if (!error) stats.building_owners_upserted++;
            }
          } else {
            const role = "titular";
            const { data: ex } = await sb.from("building_companies")
              .select("id")
              .eq("building_id", buildingId)
              .eq("company_id", r.id)
              .eq("role", role).maybeSingle();
            if (!ex) {
              const { error } = await sb.from("building_companies").insert({
                building_id: buildingId,
                company_id: r.id,
                role,
                percentage: r.porcentaje,
                source: "nota_simple",
                metadatos: { nota_simple_id: nota.id },
              });
              if (!error) stats.building_companies_upserted++;
            }
          }
        }
      }

      // 5) Detección de relaciones en raw_pdf_text
      const raw = (nota.raw_pdf_text ?? "").toString();
      if (raw && resolved.length > 0) {
        const lower = raw.toLowerCase();
        // patrones simples: "<X> heredero/a de <Y>", "<X> representante de <Y>"
        const patterns: Array<{ re: RegExp; rel: string }> = [
          { re: /([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s\.]{4,80})\s+(?:hereder[oa]s?|herederos)\s+de\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s\.]{4,80})/gi, rel: "heredero_de" },
          { re: /([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s\.]{4,80})\s+(?:representante|apoderad[oa])\s+de\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s\.]{4,80})/gi, rel: "representante_de" },
          { re: /([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s\.]{4,80})\s+(?:cónyuge|conyuge|esposo|esposa)\s+de\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s\.]{4,80})/gi, rel: "conyuge_de" },
        ];

        const ownerByName = new Map(resolved.filter(r => r.kind === "owner").map(r => [r.nombre, r.id]));

        for (const { re, rel } of patterns) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(raw)) !== null) {
            const a = normName(m[1]);
            const b = normName(m[2]);
            // resolve to owners (must already exist among titulares OR lookup)
            const findOwner = async (n: string): Promise<string | null> => {
              const hit = ownerByName.get(n);
              if (hit) return hit;
              const { data } = await sb.from("owners").select("id").ilike("nombre", n).limit(1).maybeSingle();
              return data?.id ?? null;
            };
            const oa = await findOwner(a);
            const ob = await findOwner(b);
            if (oa && ob && oa !== ob) {
              if (!dryRun) {
                const { data: ex } = await sb.from("owner_relations")
                  .select("id")
                  .eq("owner_a_id", oa).eq("owner_b_id", ob).eq("relation_type", rel)
                  .maybeSingle();
                if (!ex) {
                  await sb.from("owner_relations").insert({
                    owner_a_id: oa, owner_b_id: ob, relation_type: rel,
                    source: "nota_simple",
                    notes: m[0].slice(0, 200),
                    metadatos: { nota_simple_id: nota.id },
                  });
                }
              }
              stats.owner_relations_detected++;
            }
          }
        }
      }

      stats.notas_processed++;
    } catch (e) {
      stats.errors.push({ nota_id: nota.id, error: (e as Error).message });
    }
  }

  return new Response(JSON.stringify({ ok: true, dry_run: dryRun, stats }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});