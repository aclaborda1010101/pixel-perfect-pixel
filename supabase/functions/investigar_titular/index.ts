// Investigación previa (T-01) contra ST Intelligence Lab.
// Nunca escribe en la ficha del propietario: sólo deja una PROPUESTA en
// `descubrimientos` que un humano aprueba o descarta desde la tarjeta.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";
import {
  claveCache,
  costeEstimado,
  evaluarAmbiguedad,
  extraerHallazgos,
  normalizarDocumento,
  planInvestigacion,
  PASOS_MANUALES,
  type PasoPlan,
  type SujetoInvestigacion,
} from "../_shared/investigacion/plan.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BASE = "https://stintelligencelab.com";
const AVISO_SIN_ACCESO = "El acceso al proveedor de datos no está activo todavía";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Llamada = { ok: boolean; status: number; body: unknown; raw: string };

async function llamarProveedor(apiKey: string, paso: PasoPlan, path: string): Promise<Llamada> {
  const res = await fetch(`${BASE}${path}`, {
    method: paso.metodo,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: paso.metodo === "POST" ? JSON.stringify(paso.body ?? {}) : undefined,
  });
  const raw = await res.text();
  let body: unknown = null;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = { raw }; }
  return { ok: res.ok, status: res.status, body, raw: raw.slice(0, 2000) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const sb = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userRes } = await sb.auth.getUser();
  const user = userRes?.user;
  if (!user) return json({ ok: false, error: "no_autenticado" }, 401);

  const { data: roles } = await sb.from("user_roles").select("role").eq("user_id", user.id);
  if (!roles || roles.length === 0) return json({ ok: false, error: "sin_permiso" }, 403);

  let payloadIn: any = {};
  try { payloadIn = await req.json(); } catch { payloadIn = {}; }
  const accion = String(payloadIn.accion ?? "investigar");
  const simular = payloadIn.simular === true;

  // --- Sujeto -------------------------------------------------------------
  const ownerId: string | null = payloadIn.owner_id ?? null;
  const buildingId: string | null = payloadIn.building_id ?? null;
  const taskId: string | null = payloadIn.task_id ?? null;

  let sujeto: SujetoInvestigacion = {
    ownerId, buildingId,
    nombre: null, documento: null, telefonoActual: null,
    direccionEdificio: null, ciudad: null, provincia: null,
  };

  if (ownerId) {
    const { data: owner } = await sb
      .from("owners").select("id,nombre,nombre_display,telefono").eq("id", ownerId).maybeSingle();
    sujeto.nombre = (owner as any)?.nombre_display ?? (owner as any)?.nombre ?? null;
    sujeto.telefonoActual = (owner as any)?.telefono ?? null;
    const { data: tit } = await sb
      .from("nota_simple_titulares").select("cif_dni").eq("owner_id", ownerId).limit(5);
    const doc = (tit ?? []).map((t: any) => normalizarDocumento(t?.cif_dni)).find(Boolean);
    sujeto.documento = doc ?? null;
  }
  if (buildingId) {
    const { data: b } = await sb
      .from("buildings").select("direccion,ciudad").eq("id", buildingId).maybeSingle();
    sujeto.direccionEdificio = (b as any)?.direccion ?? null;
    sujeto.ciudad = (b as any)?.ciudad ?? null;
    sujeto.provincia = (b as any)?.ciudad ?? null;
  }

  const pasos = planInvestigacion(sujeto);
  const coste = costeEstimado(pasos);

  if (accion === "plan") {
    return json({
      ok: true, accion: "plan", sujeto, coste,
      pasos: pasos.map((p) => ({ tipo: p.tipo, coste: p.coste, condicional: p.condicional, descripcion: p.descripcion })),
      pasos_manuales: PASOS_MANUALES,
      acceso_proveedor: !!Deno.env.get("STINTELLIGENCE_API_KEY"),
    });
  }

  if (pasos.length === 0) {
    return json({
      ok: false, error: "sin_datos_de_partida",
      mensaje: "No hay ni documento ni nombre del propietario con los que buscar.",
      pasos_manuales: PASOS_MANUALES,
    }, 200);
  }

  // --- Caché obligatoria: la misma búsqueda no se repite -------------------
  const clavePrincipal = claveCache(pasos[0].tipo, sujeto);
  const { data: cacheado } = await sb
    .from("descubrimientos").select("*")
    .eq("fuente", "stintelligencelab")
    .eq("tipo_busqueda", pasos[0].tipo)
    .eq("clave_busqueda", clavePrincipal)
    .maybeSingle();
  if (cacheado && !payloadIn.forzar) {
    return json({ ok: true, cacheado: true, descubrimiento: cacheado, coste_real: 0, pasos_manuales: PASOS_MANUALES });
  }

  // --- Simulación de proveedor (para validar el flujo sin credencial) ------
  if (simular) {
    const muestra = payloadIn.respuesta_simulada ?? {
      results: [{
        personId: "SIM-0001",
        phones: ["600111222"],
        addresses: [
          { address: "Calle Ejemplo 1", town: "Madrid", province: "Madrid", postal_code: "28001", current: true },
          { address: "Calle Anterior 9", town: "Madrid", province: "Madrid", current: false },
        ],
        company: { name: "EJEMPLO SL", nif: "B00000000" },
      }],
    };
    const h = extraerHallazgos(muestra);
    const amb = evaluarAmbiguedad(h, sujeto);
    const { data: ins, error } = await sb.from("descubrimientos").insert({
      owner_id: ownerId, building_id: buildingId, task_id: taskId,
      fuente: "stintelligencelab", tipo_busqueda: pasos[0].tipo,
      clave_busqueda: `SIM|${clavePrincipal}|${Date.now()}`,
      payload: { simulacion: true, respuesta: muestra, plan: pasos },
      telefonos_encontrados: h.telefonos, domicilios: h.domicilios,
      empresa_vinculada: h.empresa, coste_monedas: 0,
      estado: "propuesta", ambiguo: amb.ambiguo, ambiguo_motivo: amb.motivo,
      simulado: true, creado_por: user.id,
    }).select("*").maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, simulado: true, descubrimiento: ins, coste_estimado: coste, pasos_manuales: PASOS_MANUALES });
  }

  // --- Ejecución real ------------------------------------------------------
  const apiKey = Deno.env.get("STINTELLIGENCE_API_KEY");
  if (!apiKey) {
    return json({
      ok: false, acceso_proveedor: false, aviso: AVISO_SIN_ACCESO,
      detalle: "Falta la credencial STINTELLIGENCE_API_KEY.",
      coste_estimado: coste, pasos_manuales: PASOS_MANUALES,
    }, 200);
  }

  const traza: any[] = [];
  let costeReal = 0;
  let acumulado: unknown[] = [];
  let personId: string | null = null;
  let telefonos: string[] = [];

  for (const paso of pasos) {
    if (paso.condicional && telefonos.length > 0) continue;
    let path = paso.path;
    if (path.includes(":id")) {
      if (!personId) continue;
      path = path.replace(":id", encodeURIComponent(personId));
    }
    let r: Llamada;
    try {
      r = await llamarProveedor(apiKey, paso, path);
    } catch (e) {
      traza.push({ tipo: paso.tipo, error: String((e as Error)?.message ?? e) });
      break;
    }
    traza.push({ tipo: paso.tipo, status: r.status, respuesta: r.body });

    if (r.status === 401 || r.status === 403) {
      await sb.from("descubrimientos").insert({
        owner_id: ownerId, building_id: buildingId, task_id: taskId,
        fuente: "stintelligencelab", tipo_busqueda: paso.tipo,
        clave_busqueda: `SINACCESO|${clavePrincipal}|${Date.now()}`,
        payload: { traza, plan: pasos }, coste_monedas: 0,
        estado: "sin_acceso", creado_por: user.id,
      });
      return json({
        ok: false, acceso_proveedor: false, aviso: AVISO_SIN_ACCESO,
        status: r.status, respuesta_proveedor: r.raw,
        coste_estimado: coste, pasos_manuales: PASOS_MANUALES,
      }, 200);
    }
    if (!r.ok) {
      await sb.from("descubrimientos").insert({
        owner_id: ownerId, building_id: buildingId, task_id: taskId,
        fuente: "stintelligencelab", tipo_busqueda: paso.tipo,
        clave_busqueda: `ERROR|${clavePrincipal}|${Date.now()}`,
        payload: { traza, plan: pasos }, coste_monedas: costeReal,
        estado: "error", creado_por: user.id,
      });
      return json({ ok: false, error: "proveedor_error", status: r.status, respuesta_proveedor: r.raw }, 200);
    }

    costeReal += paso.coste;
    acumulado.push(r.body);
    const parcial = extraerHallazgos(r.body);
    if (!personId && parcial.personIds.length > 0) personId = parcial.personIds[0];
    telefonos = Array.from(new Set([...telefonos, ...parcial.telefonos]));
  }

  const hallazgos = extraerHallazgos(acumulado);
  const amb = evaluarAmbiguedad(hallazgos, sujeto);

  const { data: ins, error } = await sb.from("descubrimientos").insert({
    owner_id: ownerId, building_id: buildingId, task_id: taskId,
    fuente: "stintelligencelab", tipo_busqueda: pasos[0].tipo,
    clave_busqueda: clavePrincipal,
    payload: { traza, plan: pasos },
    telefonos_encontrados: hallazgos.telefonos,
    domicilios: hallazgos.domicilios,
    empresa_vinculada: hallazgos.empresa,
    coste_monedas: costeReal,
    estado: "propuesta", ambiguo: amb.ambiguo, ambiguo_motivo: amb.motivo,
    creado_por: user.id,
  }).select("*").maybeSingle();
  if (error) return json({ ok: false, error: error.message }, 500);

  return json({
    ok: true, descubrimiento: ins, coste_real: costeReal,
    coste_estimado: coste, pasos_manuales: PASOS_MANUALES,
  });
});