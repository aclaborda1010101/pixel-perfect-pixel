import { createClient } from "npm:@supabase/supabase-js@2";
import { evoFetch, EVOLUTION_INSTANCE, normalizePhone } from "../_shared/evolution.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { conversation_id, phone, text, ai_generated } = await req.json();
    if (!text || (!conversation_id && !phone)) {
      return new Response(JSON.stringify({ error: "conversation_id|phone + text requeridos" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Identificar al agente humano que envía (si el call viene autenticado).
    let agentUserId: string | null = null;
    if (!ai_generated) {
      const auth = req.headers.get("Authorization") ?? "";
      const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : null;
      if (jwt) {
        try {
          const { data: u } = await admin.auth.getUser(jwt);
          agentUserId = u?.user?.id ?? null;
        } catch { /* anónimo */ }
      }
    }

    let convId = conversation_id as string | null;
    let contactId: string | null = null;
    let toPhone = phone ? normalizePhone(phone) : null;

    if (convId) {
      const { data: c } = await admin.from("wa_conversations").select("id, contact_id, wa_contacts(phone)").eq("id", convId).single();
      contactId = c?.contact_id ?? null;
      toPhone = (c as any)?.wa_contacts?.phone ?? toPhone;
    } else if (toPhone) {
      const { data: contact } = await admin.from("wa_contacts").upsert({ phone: toPhone }, { onConflict: "phone" }).select("id").single();
      contactId = contact!.id;
      const { data: conv } = await admin.from("wa_conversations").insert({ contact_id: contactId, status: "open" }).select("id").single();
      convId = conv!.id;
    }
    if (!toPhone || !convId || !contactId) {
      return new Response(JSON.stringify({ error: "destinatario inválido" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const res = await evoFetch(`/message/sendText/${EVOLUTION_INSTANCE}`, {
      method: "POST",
      body: JSON.stringify({ number: toPhone, text }),
    });

    await admin.from("wa_messages").insert({
      conversation_id: convId,
      contact_id: contactId,
      direction: "out",
      type: "text",
      content: text,
      evolution_message_id: res?.key?.id ?? null,
      ai_generated: !!ai_generated,
      sender_type: ai_generated ? "bot" : "human_agent",
      agent_user_id: agentUserId,
      metadata: { evo: res },
    });
    await admin.from("wa_conversations").update({ last_message_at: new Date().toISOString() }).eq("id", convId);

    return new Response(JSON.stringify({ ok: true, conversation_id: convId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});