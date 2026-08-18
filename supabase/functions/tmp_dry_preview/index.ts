// TEMPORAL — sólo simulación de lectura para verificar el mapeo de campos.
// No escribe nada. Se elimina en cuanto termina la comprobación.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, hubspotFetch } from "../_shared/hubspot.ts";
import {
  planCamposContacto, prioridadOriginacion, piezaDecisoria,
  codigoTipologia, etiquetaTipologiaPortal, type OpcionesPortal,
} from "../_shared/hubspotWrite/mapping.ts";

const TOKEN = "dry-9f31c2b7-0a44-4f6e-9a2f-6d1c0d3e77aa";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const body = await req.json().catch(() => ({}));
  if (body?.token !== TOKEN) return new Response(JSON.stringify({ error: "no" }), { status: 401, headers: corsHeaders });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const res = await hubspotFetch("/crm/v3/properties/contacts");
  const nombres: string[] = []; const opciones: OpcionesPortal = {};
  for (const p of res?.results ?? []) {
    nombres.push(String(p.name));
    const o = (p.options ?? []).map((x: any) => String(x.label));
    if (o.length) opciones[String(p.name)] = o;
  }

  const muestras: unknown[] = [];
  for (const id of (body.owner_ids ?? []).slice(0, 10)) {
    const { data: o } = await sb.from("owners")
      .select("id,nombre,telefono,consentimiento,buyer_persona,estado_vital,metadatos").eq("id", id).maybeSingle();
    if (!o) continue;
    const { data: bo } = await sb.from("building_owners")
      .select("building_id,cuota,es_influencer").eq("owner_id", id).limit(1).maybeSingle();
    let b: any = null;
    if (bo?.building_id) {
      const r = await sb.from("buildings").select("direccion,estado,interlocutor_owner_id,interlocutor_marcado_por")
        .eq("id", bo.building_id).maybeSingle();
      b = r.data;
    }
    const meta = (o.metadatos ?? {}) as Record<string, unknown>;
    const tel = String(o.telefono ?? meta.phone ?? "").trim();
    const participacion = bo?.cuota ?? null;
    const influencer = bo?.es_influencer === true;
    const plan = planCamposContacto({
      situacion_comercial: b?.estado ?? null,
      interlocutor: b?.interlocutor_owner_id === id,
      es_influencer: influencer,
      participacion,
      consentimiento_whatsapp: o.consentimiento ?? null,
      tipologia: etiquetaTipologiaPortal(codigoTipologia({
        buyerPersona: o.buyer_persona, esInfluencer: influencer,
        fallecido: String(o.estado_vital ?? "") === "fallecido",
      }), opciones["tipologia_de_propietario"]),
      prioridad_originacion: prioridadOriginacion({
        campanaJunio: !!meta.prioridad_originacion || !!meta.revista_campana,
        participacionRelevante: Number(participacion ?? 0) >= 25,
        sinTelefono: tel === "",
        edificioDescartado: String(b?.estado ?? "") === "descartado",
        sinDerechoEnNota: !!bo && (participacion === null || Number(participacion) <= 0) && !influencer,
        contactable: tel !== "",
      }),
      pieza_decisoria: piezaDecisoria({
        hayInterlocutor: !!b?.interlocutor_owner_id,
        esInterlocutor: b?.interlocutor_owner_id === id,
        marcadoPorSistema: String(b?.interlocutor_marcado_por ?? "").toLowerCase() === "sistema",
      }),
      predisposicion: (meta.predisposicion_a_vender as string) ?? null,
      quien_bloquea: (meta.quien_o_que_bloquea as string) ?? null,
    }, nombres, opciones);
    muestras.push({ nombre: o.nombre, edificio: b?.direccion ?? null, telefono: tel || null, plan });
  }
  const cinco = ["prioridad_de_originacion","pieza_decisoria","predisposicion_a_vender","tipologia_de_propietario","quien_o_que_bloquea"];
  return new Response(JSON.stringify({
    existen: Object.fromEntries(cinco.map((c) => [c, nombres.includes(c)])),
    opciones: Object.fromEntries(cinco.map((c) => [c, opciones[c] ?? null])),
    muestras,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
