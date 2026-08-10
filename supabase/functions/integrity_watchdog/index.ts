// integrity_watchdog — cron cada 30 min. Envía email a agustin.cifuentes@afflux.es
// cuando public.integridad_alertas_pendientes() devuelve alertas activas.
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail, escapeHtml } from "../_shared/mailer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NOTIFY_EMAIL = "agustin.cifuentes@afflux.es";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const startedAt = new Date().toISOString();
  try {
    const { data, error } = await admin.rpc("integridad_alertas_pendientes");
    if (error) throw error;
    const rows = (data ?? []) as Array<{ issue_key: string; detalle: string; severidad?: string }>;

    if (rows.length === 0) {
      await admin.from("hubspot_sync_log").insert({
        entity: "integrity_watchdog",
        status: "ok",
        records_upserted: 0,
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
      return new Response(JSON.stringify({ ok: true, alerts: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const n = rows.length;
    const orden = ["ERROR", "CALIDAD", "AVISO"];
    const etiqueta: Record<string, string> = {
      ERROR: "Errores técnicos",
      CALIDAD: "Problemas de calidad de datos",
      AVISO: "Avisos",
    };
    const nErr = rows.filter((r) => (r.severidad ?? "AVISO") === "ERROR").length;
    const subject = nErr > 0
      ? `[AffluxOS] ${nErr} error(es) técnico(s) y ${n - nErr} aviso(s) de integridad`
      : `[AffluxOS] ${n} aviso(s) de integridad`;
    const itemsHtml = orden
      .filter((sev) => rows.some((r) => (r.severidad ?? "AVISO") === sev))
      .map((sev) => `<h3 style="margin:14px 0 4px">${etiqueta[sev]}</h3><ul>` +
        rows.filter((r) => (r.severidad ?? "AVISO") === sev)
          .map((r) => `<li><b>${escapeHtml(r.issue_key)}</b>: ${escapeHtml(r.detalle)}</li>`)
          .join("") + `</ul>`)
      .join("");
    const html = `
      <div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
        <h2 style="margin:0 0 12px">Vigía de integridad · ${n} alerta(s)</h2>
        ${itemsHtml}
        <p style="margin-top:16px">Panel: <code>/admin/integridad</code></p>
      </div>`;
    const text = `Vigía de integridad · ${n} alerta(s)\n\n` +
      rows.map((r) => `- [${r.severidad ?? "AVISO"}] ${r.issue_key}: ${r.detalle}`).join("\n") +
      `\n\nPanel: /admin/integridad`;

    const send = await sendEmail({ to: NOTIFY_EMAIL, subject, html, text });
    if (!send.ok) {
      await admin.from("hubspot_sync_log").insert({
        entity: "integrity_watchdog",
        status: "error",
        records_upserted: 0,
        error_message: send.error ?? "send_failed",
        started_at: startedAt,
        finished_at: new Date().toISOString(),
      });
      return new Response(JSON.stringify({ ok: false, error: send.error, alerts: n }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const keys = rows.map((r) => r.issue_key);
    const detalles = rows.map((r) => r.detalle);
    const { error: markErr } = await admin.rpc("integridad_alertas_marcar", {
      p_keys: keys,
      p_detalles: detalles,
    });
    if (markErr) console.error("[integrity_watchdog] marcar fail", markErr.message);

    await admin.from("hubspot_sync_log").insert({
      entity: "integrity_watchdog",
      status: "ok",
      records_upserted: n,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ ok: true, alerts: n, sent: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    await admin.from("hubspot_sync_log").insert({
      entity: "integrity_watchdog",
      status: "error",
      records_upserted: 0,
      error_message: String(e?.message ?? e).slice(0, 500),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    }).then(() => {}, () => {});
    return new Response(JSON.stringify({ ok: false, error: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});