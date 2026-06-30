// Cadencia de seguimiento controlada. Se ejecuta vía pg_cron cada hora.
// Regla: si el ÚLTIMO mensaje de una conversación con ai_enabled=true es saliente
// (cliente no ha respondido), enviamos como mucho 2 seguimientos espaciados.
// Al 3º intento sin respuesta, marcamos al contacto en stage='handoff'.
import { createClient } from "npm:@supabase/supabase-js@2";
import { evoFetch, EVOLUTION_INSTANCE } from "../_shared/evolution.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function madridHour(): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", hour: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return Number(parts.hour);
}

const FOLLOWUP_1 = "Hola de nuevo, le escribo del equipo de Afflux. No quiero molestarle: si prefiere que dejemos esta conversación aquí, dígamelo y no le escribo más. Si en algún momento le interesa entender qué opciones tiene con su parte del edificio, sigo por aquí cuando le venga bien.";
const FOLLOWUP_2 = "Le escribo solo una última vez. Si no es el momento, lo respeto y no le contacto más por aquí. Si más adelante quisiera ver con números lo que vale realmente su parte, sin compromiso, basta con que me responda a este mensaje.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: cfg } = await admin.from("wa_bot_config").select("active_hours, is_active").limit(1).maybeSingle();

    // KILL SWITCH GLOBAL: is_active=false ⇒ no enviamos ningún seguimiento.
    if ((cfg as any)?.is_active === false) {
      return new Response(JSON.stringify({ ok: true, skip: "kill_switch" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ah = (cfg as any)?.active_hours ?? { from: "09:00", to: "21:00" };
    const fromH = Number(String(ah.from || "09:00").split(":")[0]) || 9;
    const toH   = Number(String(ah.to   || "21:00").split(":")[0]) || 21;
    const nowH = madridHour();
    if (nowH < fromH || nowH >= toH) {
      return new Response(JSON.stringify({ ok: true, skip: "off_hours" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Solo conversaciones abiertas con bot activo (y contacto no en handoff).
    // Importante: un /reset cierra la conversación anterior; nunca debe disparar
    // follow-ups desde conversaciones ya cerradas.
    const { data: convs } = await admin
      .from("wa_conversations")
      .select("id, contact_id, ai_enabled, wa_contacts(id, phone, name, stage)")
      .eq("ai_enabled", true)
      .eq("status", "open")
      .limit(500);

    const results: any[] = [];
    const now = Date.now();
    const H24 = 24 * 60 * 60 * 1000;
    const H72 = 72 * 60 * 60 * 1000;

    for (const conv of (convs ?? []) as any[]) {
      const contact = conv.wa_contacts;
      if (!contact || contact.stage === "handoff") continue;

      const { data: msgs } = await admin
        .from("wa_messages")
        .select("direction, type, created_at, sender_type, metadata")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: true })
        .limit(80);
      const real = (msgs ?? []).filter((m: any) => {
        if (m.type === "system" || m.sender_type === "system") return false;
        if (m.metadata?.command === "reset" || m.metadata?.command === "reset_ack") return false;
        return true;
      });
      if (real.length === 0) continue;
      const last = real[real.length - 1];
      // El último debe ser saliente (cliente no ha respondido).
      if (last.direction !== "out") continue;

      // Contamos salientes consecutivos desde el último entrante.
      let salientesSinRespuesta = 0;
      let firstOutTs: number | null = null;
      for (let i = real.length - 1; i >= 0; i--) {
        const m = real[i];
        if (m.direction === "in") break;
        salientesSinRespuesta++;
        firstOutTs = new Date(m.created_at).getTime();
      }
      const lastOutTs = new Date(last.created_at).getTime();

      // ≥3 salientes sin respuesta → handoff y no enviar más.
      if (salientesSinRespuesta >= 3) {
        await admin.from("wa_contacts").update({
          stage: "handoff",
          handoff_reason: "Sin respuesta tras 3 intentos — requiere toque humano",
        }).eq("id", contact.id);
        results.push({ conv: conv.id, action: "handoff" });
        continue;
      }

      let body: string | null = null;
      let kind: string | null = null;
      if (salientesSinRespuesta === 1 && (now - lastOutTs) >= H24) {
        body = FOLLOWUP_1; kind = "followup_1";
      } else if (salientesSinRespuesta === 2 && firstOutTs && (now - firstOutTs) >= H72) {
        body = FOLLOWUP_2; kind = "followup_2";
      }
      if (!body || !kind) continue;

      try {
        const sendRes = await evoFetch(`/message/sendText/${EVOLUTION_INSTANCE}`, {
          method: "POST",
          body: JSON.stringify({ number: contact.phone, text: body }),
        });
        await admin.from("wa_messages").insert({
          conversation_id: conv.id,
          contact_id: contact.id,
          direction: "out",
          type: "text",
          content: body,
          ai_generated: true,
          evolution_message_id: sendRes?.key?.id ?? null,
          metadata: { followup: kind },
        });
        await admin.from("wa_conversations").update({
          last_message_at: new Date().toISOString(),
        }).eq("id", conv.id);
        results.push({ conv: conv.id, action: kind });
      } catch (e: any) {
        results.push({ conv: conv.id, error: String(e?.message ?? e) });
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});