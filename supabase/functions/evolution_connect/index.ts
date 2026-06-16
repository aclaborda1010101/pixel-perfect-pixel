// Crea (si no existe) la instancia de Evolution, configura webhook y devuelve el QR.
import { createClient } from "npm:@supabase/supabase-js@2";
import { evoFetch, EVOLUTION_INSTANCE } from "../_shared/evolution.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE);

    const webhookUrl = `${SUPABASE_URL}/functions/v1/evolution_webhook`;
    const instanceName = EVOLUTION_INSTANCE;

    // 1) Intentar crear (idempotente: si existe devolverá error que ignoramos)
    try {
      await evoFetch("/instance/create", {
        method: "POST",
        body: JSON.stringify({
          instanceName,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",
          webhook: {
            url: webhookUrl,
            byEvents: false,
            base64: true,
            events: ["QRCODE_UPDATED", "MESSAGES_UPSERT", "CONNECTION_UPDATE", "MESSAGES_UPDATE"],
          },
        }),
      });
    } catch (_e) { /* probablemente ya existe */ }

    // 2) Asegurar webhook
    try {
      await evoFetch(`/webhook/set/${instanceName}`, {
        method: "POST",
        body: JSON.stringify({
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          webhookBase64: true,
          events: ["QRCODE_UPDATED", "MESSAGES_UPSERT", "CONNECTION_UPDATE", "MESSAGES_UPDATE"],
        }),
      });
    } catch (_e) { /* algunas versiones usan otro path */ }

    // 3) Solicitar QR / conectar
    let qr_base64: string | null = null;
    let status = "qr";
    try {
      const conn = await evoFetch(`/instance/connect/${instanceName}`, { method: "GET" });
      const raw = conn?.base64 ?? conn?.qrcode?.base64 ?? conn?.qr ?? null;
      qr_base64 = raw ? (String(raw).startsWith("data:") ? raw : `data:image/png;base64,${raw}`) : null;
      if (conn?.instance?.state === "open" || conn?.state === "open") status = "connected";
    } catch (_e) { /* puede que ya esté conectado */ }

    // 4) Estado real
    try {
      const st = await evoFetch(`/instance/connectionState/${instanceName}`, { method: "GET" });
      const state = st?.instance?.state ?? st?.state ?? null;
      if (state === "open") status = "connected";
      else if (state === "connecting") status = "connecting";
      else if (state === "close") status = "disconnected";
    } catch (_e) { /* ignore */ }

    await admin.from("wa_instances").upsert({
      instance_name: instanceName,
      status,
      qr_base64,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "instance_name" });

    return new Response(JSON.stringify({ ok: true, instance: instanceName, status, qr_base64 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});