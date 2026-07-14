// wa_conversation_email_dispatcher — cron cada minuto.
// Envía:
//  1) Email inmediato "conv_started" (si no ha salido aún) tras nueva conversación WhatsApp.
//  2) Email de resumen a los 15 min ("summary_15m") con datos extraídos por IA.
// Todo va a NOTIFY_EMAIL (default: carlos.moreno@afflux.es).
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendEmail, escapeHtml } from "../_shared/mailer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NOTIFY_EMAIL = Deno.env.get("WA_NOTIFY_EMAIL") || "carlos.moreno@afflux.es";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const LOVABLE_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LUNA_MODEL = "openai/gpt-5.6-luna";
const FALLBACK_MODEL = "google/gemini-3-flash-preview";

async function summarizeConversation(messages: Array<{ direction: string; content: string; created_at: string }>, contact: any): Promise<any> {
  const OR = Deno.env.get("OPENROUTER_API_KEY") || "";
  const LK = Deno.env.get("LOVABLE_API_KEY") || "";
  const providers: Array<{ name: string; url: string; auth: string; model: string; extra?: Record<string,string> }> = [];
  if (OR) providers.push({
    name: "openrouter", url: OPENROUTER_URL, auth: `Bearer ${OR}`, model: LUNA_MODEL,
    extra: { "HTTP-Referer": "https://affluxosv2.world", "X-Title": "Afflux OS · WA Summary" },
  });
  if (LK) providers.push({ name: "lovable", url: LOVABLE_URL, auth: `Bearer ${LK}`, model: FALLBACK_MODEL });

  const transcript = messages.map((m) => `[${m.direction === "in" ? "Cliente" : "Bot"}] ${(m.content || "").slice(0, 500)}`).join("\n");
  const sys = `Eres un analista comercial inmobiliario. Recibes el hilo WhatsApp entre el bot de Afflux y un lead. Devuelve JSON estricto:
{
  "resumen": "3-6 líneas del hilo",
  "datos": {
    "nombre": "nombre y apellidos si aparecen o null",
    "direccion_inmueble": "dirección del inmueble o null",
    "tipo_inmueble": "piso|edificio|local|otro o null",
    "codigo_postal": "CP o null",
    "perfil_tipologia": "tipología detectada (T1..T10 o descriptiva) o null",
    "cualificacion": "cualificado|dudoso|no_cualificado o null"
  },
  "cualificado": ["viñetas con lo cualificado hasta ahora"]
}
No inventes. Si un dato no aparece, null. Sin markdown.`;
  const user = `Contacto: ${JSON.stringify({ nombre: contact?.name, phone: contact?.phone })}\n\nMENSAJES:\n${transcript}`;
  for (const p of providers) {
    try {
      const r = await fetch(p.url, {
        method: "POST",
        headers: { Authorization: p.auth, "Content-Type": "application/json", ...(p.extra ?? {}) },
        body: JSON.stringify({
          model: p.model,
          messages: [{ role: "system", content: sys }, { role: "user", content: user }],
          response_format: { type: "json_object" },
        }),
      });
      if (!r.ok) { console.error(`[wa_dispatch] AI ${p.name} status=${r.status}`, (await r.text()).slice(0,200)); continue; }
      const j = await r.json();
      let txt = j?.choices?.[0]?.message?.content || "{}";
      txt = String(txt).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
      return JSON.parse(txt);
    } catch (e) { console.error(`[wa_dispatch] AI ${p.name} exception`, (e as any)?.message); }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Pull todas las pendientes vencidas (limit razonable)
    const { data: due } = await admin
      .from("pending_conversation_emails")
      .select("*")
      .eq("status", "pending")
      .lte("send_at", new Date().toISOString())
      .order("send_at", { ascending: true })
      .limit(20);

    const rows = (due ?? []) as any[];
    const results: any[] = [];

    for (const row of rows) {
      try {
        const { data: conv } = await admin.from("wa_conversations")
          .select("id, contact_id, created_at, wa_contacts(id, phone, name, lead_id, metadata)")
          .eq("id", row.conversation_id).maybeSingle();
        const contact = (conv as any)?.wa_contacts ?? null;
        const phone = contact?.phone ?? row.phone ?? "—";
        const displayName = contact?.name ?? "(sin nombre)";

        if (row.kind === "conv_started") {
          const { data: firstMsg } = await admin.from("wa_messages")
            .select("content, created_at, direction")
            .eq("conversation_id", row.conversation_id).eq("direction", "in")
            .order("created_at", { ascending: true }).limit(1).maybeSingle();
          const body = firstMsg?.content ?? "(sin cuerpo)";
          const html = `
            <div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
              <h2 style="margin:0 0 12px">Nueva conversación WhatsApp iniciada</h2>
              <p><b>Lead:</b> ${escapeHtml(displayName)}<br/>
              <b>Teléfono:</b> ${escapeHtml(phone)}<br/>
              <b>Fecha:</b> ${escapeHtml((conv as any)?.created_at ?? new Date().toISOString())}</p>
              <p><b>Primer mensaje:</b></p>
              <blockquote style="border-left:3px solid #d4af37;padding-left:10px;color:#333;white-space:pre-wrap">${escapeHtml(String(body).slice(0, 2000))}</blockquote>
            </div>`;
          const send = await sendEmail({
            to: NOTIFY_EMAIL,
            subject: "Nueva conversación WhatsApp iniciada",
            html,
            text: `Nueva conversación WhatsApp\nLead: ${displayName}\nTeléfono: ${phone}\nPrimer mensaje:\n${body}`,
          });
          await admin.from("pending_conversation_emails").update({
            status: send.ok ? "sent" : "pending",
            sent_at: send.ok ? new Date().toISOString() : null,
            last_error: send.ok ? null : send.error ?? "unknown",
            updated_at: new Date().toISOString(),
          }).eq("id", row.id);
          results.push({ id: row.id, kind: row.kind, ok: send.ok });
          continue;
        }

        if (row.kind === "summary_15m") {
          const { data: msgs } = await admin.from("wa_messages")
            .select("direction, content, created_at")
            .eq("conversation_id", row.conversation_id)
            .order("created_at", { ascending: true }).limit(80);
          const list = (msgs ?? []) as any[];
          const summary = await summarizeConversation(list, contact);
          const datos = summary?.datos ?? {};
          const cual = Array.isArray(summary?.cualificado) ? summary.cualificado : [];
          const rowsHtml = Object.entries({
            "Nombre": datos.nombre,
            "Dirección inmueble": datos.direccion_inmueble,
            "Tipo inmueble": datos.tipo_inmueble,
            "Código postal": datos.codigo_postal,
            "Perfil / tipología": datos.perfil_tipologia,
            "Cualificación": datos.cualificacion,
          }).map(([k, v]) => `<tr><td style="padding:4px 8px;color:#555">${escapeHtml(k)}</td><td style="padding:4px 8px"><b>${escapeHtml(String(v ?? "—"))}</b></td></tr>`).join("");
          const html = `
            <div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
              <h2 style="margin:0 0 12px">Resumen WhatsApp · 15 min</h2>
              <p><b>Lead:</b> ${escapeHtml(displayName)} · <b>Teléfono:</b> ${escapeHtml(phone)}</p>
              <p><b>Resumen:</b><br/>${escapeHtml(summary?.resumen ?? "(sin resumen)")}</p>
              <h3 style="margin:14px 0 6px">Datos extraídos</h3>
              <table style="border-collapse:collapse">${rowsHtml}</table>
              ${cual.length ? `<h3 style="margin:14px 0 6px">Cualificado hasta ahora</h3><ul>${cual.map((c: string) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>` : ""}
              <p style="color:#888;font-size:12px;margin-top:16px">${list.length} mensajes procesados.</p>
            </div>`;
          const send = await sendEmail({
            to: NOTIFY_EMAIL,
            subject: `Resumen WhatsApp 15 min · ${displayName}`,
            html,
            text: `Resumen WhatsApp 15 min\nLead: ${displayName}\nTeléfono: ${phone}\n\n${summary?.resumen ?? ""}\n\nDatos:\n${JSON.stringify(datos, null, 2)}`,
          });
          await admin.from("pending_conversation_emails").update({
            status: send.ok ? "sent" : "pending",
            sent_at: send.ok ? new Date().toISOString() : null,
            last_error: send.ok ? null : send.error ?? "unknown",
            metadata: { ...(row.metadata ?? {}), summary },
            updated_at: new Date().toISOString(),
          }).eq("id", row.id);
          results.push({ id: row.id, kind: row.kind, ok: send.ok });
          continue;
        }

        // kind desconocido → marcar error
        await admin.from("pending_conversation_emails").update({
          status: "error", last_error: `unknown kind: ${row.kind}`, updated_at: new Date().toISOString(),
        }).eq("id", row.id);
      } catch (e: any) {
        console.error("[wa_dispatch] row error", row.id, e?.message);
        await admin.from("pending_conversation_emails").update({
          status: "error", last_error: String(e?.message ?? e), updated_at: new Date().toISOString(),
        }).eq("id", row.id);
        results.push({ id: row.id, ok: false, error: String(e?.message ?? e) });
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