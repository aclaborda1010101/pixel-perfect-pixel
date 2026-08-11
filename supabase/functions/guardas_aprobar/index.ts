// guardas_aprobar — resuelve propuestas de guardas (aprobar / rechazar).
// Aprobar en Guarda 1 => PATCH del contacto en HubSpot con hs_lead_status='Contactado'.
// Guardas 2/4/6 no escriben en HubSpot: sólo se marcan vistas (rechazada) o aprobadas.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { hubspotFetch, corsHeaders } from "../_shared/hubspot.ts";

const ENTITY = "guardas";
const MAX_LOTE = 300;

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUP = Deno.env.get("SUPABASE_URL")!;
  const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const sb = createClient(SUP, SR);

  // --- Autenticación: admin o Jesús ---
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "No autenticado" }, 401);
  const sbUser = createClient(SUP, ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: userRes } = await sbUser.auth.getUser();
  const user = userRes?.user;
  if (!user) return json({ ok: false, error: "Sesión inválida" }, 401);
  // Validación de rol de OTRO usuario: se consulta user_roles internamente con
  // el cliente de servicio. No se expone has_role(user_id, role) al llamante.
  const { data: rolAdmin } = await sb
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  const esAdmin = !!rolAdmin;
  const permitido = esAdmin === true || (user.email ?? "").toLowerCase() === "jesus.anzola@afflux.es";
  if (!permitido) return json({ ok: false, error: "Sin permisos" }, 403);

  // --- Entrada ---
  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }
  const accion = String(body?.accion ?? "");
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String).slice(0, MAX_LOTE) : [];
  if (!["aprobar", "rechazar"].includes(accion)) return json({ ok: false, error: "Acción no válida" }, 400);
  if (!ids.length) return json({ ok: false, error: "Sin propuestas seleccionadas" }, 400);

  const t0 = Date.now();
  const { data: logRow } = await sb.from("hubspot_sync_log")
    .insert({ entity: ENTITY, status: "running", metadatos: { modo: accion, total: ids.length, usuario: user.email } })
    .select("id").single();
  const logId = logRow?.id;

  const { data: props, error: pErr } = await sb.from("guard_proposals")
    .select("id, guarda, entity_id, propuesta, estado")
    .in("id", ids).eq("estado", "pendiente");
  if (pErr) return json({ ok: false, error: pErr.message }, 500);

  let escritos = 0, marcados = 0, fallidos = 0, stopped403 = false;
  const errores: any[] = [];
  const ahora = new Date().toISOString();

  for (const p of props ?? []) {
    if (stopped403) break;
    try {
      if (accion === "aprobar" && p.guarda === 1) {
        const contactId = String((p.propuesta as any)?.hs_contact_id ?? p.entity_id);
        const campo = String((p.propuesta as any)?.campo ?? "hs_lead_status");
        const valor = String((p.propuesta as any)?.valor ?? "Contactado");
        await hubspotFetch(`/crm/v3/objects/contacts/${contactId}`, {
          method: "PATCH", body: JSON.stringify({ properties: { [campo]: valor } }),
        });
        escritos++;
        const ownerId = (p.propuesta as any)?.owner_id;
        if (ownerId) {
          const { data: o } = await sb.from("owners").select("metadatos").eq("id", ownerId).maybeSingle();
          await sb.from("owners")
            .update({ metadatos: { ...((o?.metadatos as any) ?? {}), [campo]: valor } })
            .eq("id", ownerId);
        }
      }
      await sb.from("guard_proposals").update({
        estado: accion === "aprobar" ? "aprobada" : "rechazada",
        resuelto_at: ahora,
        resuelto_por: user.email ?? user.id,
      }).eq("id", p.id);
      marcados++;
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      fallidos++;
      errores.push({ id: p.id, entity_id: p.entity_id, error: msg });
      console.error(`[guardas_aprobar] fallo propuesta=${p.id}: ${msg}`);
      if (msg.includes("403") || /MISSING_SCOPES/i.test(msg)) { stopped403 = true; break; }
    }
  }

  await sb.from("hubspot_sync_log").update({
    finished_at: new Date().toISOString(),
    status: fallidos ? "error" : "ok",
    records_upserted: marcados,
    records_failed: fallidos,
    error_message: stopped403 ? "HTTP 403 MISSING_SCOPES al escribir en HubSpot" : null,
    metadatos: {
      modo: accion, usuario: user.email, solicitadas: ids.length,
      escritos_hubspot: escritos, marcados, fallidos, stopped403,
      errores: errores.slice(0, 20), elapsed_ms: Date.now() - t0,
    },
  }).eq("id", logId);

  return json({ ok: !fallidos, accion, escritos_hubspot: escritos, marcados, fallidos, stopped403, errores: errores.slice(0, 20) });
});