// PROCESO PUNTUAL: re-extracción registral de los edificios 'a_revisar'.
// No hay cron: se invoca a mano con la clave de operación. Con dry_run=true
// no escribe nada. La puerta de validación es innegociable: si una nota
// vigente no cierra, el edificio conserva sus titulares y sigue 'a_revisar'.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { elegirVigentes } from "../_shared/reparse168/finca.ts";
import { extraerHechosNota, validarPuerta, sumarCapas } from "../_shared/reparse168/extract.ts";
import { emparejarOwner, emparejarEmpresa, esSociedad } from "../_shared/reparse168/matching.ts";

const MIN_TEXTO = 200;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const token = Deno.env.get("REPARSE168_TOKEN") ?? "";
  if (!token || req.headers.get("x-reparse-token") !== token) return json({ error: "no autorizado" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* cuerpo vacío */ }
  const dryRun = body?.dry_run !== false;

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: edificios, error: eEd } = await sb.from("buildings").select("id,direccion").eq("porcentajes_estado", "a_revisar");
  if (eEd) return json({ error: eEd.message }, 500);
  const ids = (edificios ?? []).map((b: any) => b.id);

  const notas: any[] = [];
  for (let i = 0; i < ids.length; i += 40) {
    const { data, error } = await sb.from("notas_simples")
      .select("id,building_id,raw_pdf_text,created_at").eq("status", "listo").in("building_id", ids.slice(i, i + 40));
    if (error) return json({ error: error.message }, 500);
    notas.push(...(data ?? []));
  }
  const { data: bo } = await sb.from("building_owners").select("building_id,owner_id,owners(id,nombre)").in("building_id", ids);
  const { data: bc } = await sb.from("building_companies").select("building_id,company_id,companies(id,nombre,cif)").in("building_id", ids);

  const porEd = new Map<string, any[]>();
  for (const n of notas) porEd.set(n.building_id, [...(porEd.get(n.building_id) ?? []), n]);
  const ownersBy = new Map<string, any[]>();
  for (const r of bo ?? []) if (r.owners) ownersBy.set(r.building_id, [...(ownersBy.get(r.building_id) ?? []), { id: r.owners.id, nombre: r.owners.nombre }]);
  const compsBy = new Map<string, any[]>();
  for (const r of bc ?? []) if (r.companies) compsBy.set(r.building_id, [...(compsBy.get(r.building_id) ?? []), { id: r.companies.id, nombre: r.companies.nombre, cif: r.companies.cif }]);

  const resumen = { edificios: ids.length, verificado: 0, verificado_pendiente_matching: 0, a_revisar: 0, duplicadas: 0, notas_reemplazadas: 0, titulares: 0 };
  const motivos: Record<string, number> = {};
  const detalle: any[] = [];

  for (const b of edificios ?? []) {
    const conTexto = (porEd.get(b.id) ?? []).filter((n: any) => (n.raw_pdf_text ?? "").length >= MIN_TEXTO);
    let motivo = conTexto.length ? "" : "las notas del edificio no tienen texto extraído: no se pueden reprocesar sin volver a leer el PDF";
    let vigentes: string[] = [];
    let descartadas: Array<{ id: string; motivo: string }> = [];
    if (!motivo) {
      const r = elegirVigentes(conTexto.map((n: any) => ({ id: n.id, raw: n.raw_pdf_text, created_at: n.created_at })));
      vigentes = r.vigentes; descartadas = r.descartadas;
    }
    const listas: any[] = [];
    if (!motivo) {
      for (const id of vigentes) {
        const nota = conTexto.find((x: any) => x.id === id);
        const ex = extraerHechosNota(nota.raw_pdf_text);
        const p = validarPuerta(ex);
        if (!p.ok) { motivo = p.motivo; break; }
        listas.push({ nota, ex });
      }
    }
    if (motivo) {
      resumen.a_revisar++;
      const k = motivo.replace(/\d+[.,]?\d*/g, "N");
      motivos[k] = (motivos[k] ?? 0) + 1;
      continue;
    }

    const oc = ownersBy.get(b.id) ?? [];
    const cc = compsBy.get(b.id) ?? [];
    let todoEmparejado = true;
    const filas: any[] = [];
    const capas: any[] = [];
    for (const { nota, ex } of listas) {
      capas.push({ nota_id: nota.id, morfologia: ex.morfologia, hechos: ex.hechos.length, capas: sumarCapas(ex.hechos) });
      for (const h of ex.hechos) {
        const soc = esSociedad(h.nombre, h.doc);
        const mo = soc ? { id: null, score: 0, motivo: "sociedad" } : emparejarOwner(h.nombre, oc);
        const mc = soc ? emparejarEmpresa(h.nombre, h.doc, cc) : { id: null, score: 0, motivo: "persona" };
        if (!mo.id && !mc.id) todoEmparejado = false;
        filas.push({
          nota_simple_id: nota.id,
          owner_id: mo.id, company_id: mc.id,
          nombre_extraido: h.nombre, cif_dni: h.doc, porcentaje: h.porcentaje,
          rol: h.gananciales && h.rol === "pleno" ? "ganancial" : h.rol,
          rol_literal: h.rol_literal,
          evidencia: { fuente: "reparse_168", offset: h.offset, cita: h.cita, forma: h.forma },
          metadatos: { reparse_168: true, morfologia: ex.morfologia, match_owner: mo, match_company: mc, gananciales: h.gananciales },
        });
      }
    }
    const estado = todoEmparejado ? "verificado" : "verificado_pendiente_matching";
    resumen[estado as "verificado"]++;
    resumen.notas_reemplazadas += listas.length;
    resumen.titulares += filas.length;
    resumen.duplicadas += descartadas.length;
    detalle.push({ building_id: b.id, direccion: b.direccion, estado, notas: capas });

    if (dryRun) continue;

    for (const { nota } of listas) {
      const { data: viejos, error: eSel } = await sb.from("nota_simple_titulares").select("*").eq("nota_simple_id", nota.id);
      if (eSel) return json({ error: eSel.message }, 500);
      if (viejos?.length) {
        const { error: eBk } = await sb.from("backup_reparse168_titulares").insert(viejos.map((t: any) => ({
          titular_id: t.id, nota_simple_id: t.nota_simple_id, building_id: b.id, owner_id: t.owner_id, company_id: t.company_id,
          nombre_extraido: t.nombre_extraido, cif_dni: t.cif_dni, porcentaje: t.porcentaje, rol: t.rol,
          rol_literal: t.rol_literal, evidencia: t.evidencia, metadatos: t.metadatos,
        })));
        if (eBk) return json({ error: eBk.message }, 500);
        const { error: eDel } = await sb.from("nota_simple_titulares").delete().eq("nota_simple_id", nota.id);
        if (eDel) return json({ error: eDel.message }, 500);
      }
    }
    const { error: eIns } = await sb.from("nota_simple_titulares").insert(filas);
    if (eIns) return json({ error: eIns.message }, 500);
    for (const d of descartadas) {
      await sb.from("notas_simples").update({ status: "duplicada_descartada", error_message: `versión anterior de la misma finca: ${d.motivo}` }).eq("id", d.id);
    }
    const { error: eUpd } = await sb.from("buildings").update({ porcentajes_estado: estado }).eq("id", b.id);
    if (eUpd) return json({ error: eUpd.message }, 500);
  }

  return json({ ok: true, dry_run: dryRun, resumen, motivos, detalle: detalle.slice(0, 200) });
});
