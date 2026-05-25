import { corsHeaders, err, getServiceClient, json } from "../_shared/scoring_v2_common.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return err("POST only", 405);

  try {
    const ct = req.headers.get("content-type") ?? "";
    let rows: Array<Record<string, string>> = [];

    if (ct.includes("application/json")) {
      const body = await req.json();
      rows = Array.isArray(body?.rows) ? body.rows : [];
    } else {
      // CSV en multipart o texto plano
      const text = ct.includes("multipart/form-data")
        ? (await (await req.formData()).get("file") as File)?.text() ?? ""
        : await req.text();
      rows = parseCsv(text);
    }
    if (rows.length === 0) return err("CSV vacío o sin filas válidas", 400);

    const sb = getServiceClient();
    let matched = 0;
    const unmatched: string[] = [];

    for (const row of rows) {
      const edificio = (row.edificio ?? row.Edificio ?? row.EDIFICIO ?? "").trim();
      const direccion = (row.direccion ?? row.Direccion ?? row["Dirección"] ?? "").trim();
      const hubspot_deal_id = (row.hubspot_deal_id ?? row.deal_id ?? "").trim();
      if (!edificio) continue;

      let matched_building_id: string | null = null;

      if (hubspot_deal_id) {
        const { data } = await sb
          .from("buildings")
          .select("id")
          .filter("metadatos->>hs_object_id", "eq", hubspot_deal_id)
          .maybeSingle();
        matched_building_id = data?.id ?? null;
      }
      if (!matched_building_id && direccion) {
        const { data } = await sb.rpc("match_building_fuzzy", {
          p_direccion: direccion,
          p_ciudad: "Madrid",
          p_threshold: 0.35,
        });
        matched_building_id = (data as string | null) ?? null;
      }

      await sb.from("scoring_v2_seed").upsert({
        edificio,
        direccion: direccion || null,
        hubspot_deal_id: hubspot_deal_id || null,
        raw: row,
        matched_building_id,
        matched_at: matched_building_id ? new Date().toISOString() : null,
      });
      if (matched_building_id) {
        // Marca el edificio como parte de la cartera demo de mayo
        await sb
          .from("buildings")
          .update({ cartera_demo_seed: true })
          .eq("id", matched_building_id);
        matched++;
      } else {
        unmatched.push(edificio);
      }
    }

    return json({ total: rows.length, matched, unmatched });
  } catch (e) {
    console.error("seed-edificios-import error", e);
    return err(String((e as Error).message ?? e));
  }
});

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const out: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => (row[h] = (cells[idx] ?? "").trim()));
    out.push(row);
  }
  return out;
}
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === "," && !inQ) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}