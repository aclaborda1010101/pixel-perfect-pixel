// Genera respuesta del bot con Lovable AI y la envía por Evolution.
import { createClient } from "npm:@supabase/supabase-js@2";
import { evoFetch, EVOLUTION_INSTANCE } from "../_shared/evolution.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { conversation_id } = await req.json();
    if (!conversation_id) return new Response(JSON.stringify({ error: "conversation_id requerido" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: conv } = await admin.from("wa_conversations").select("id, ai_enabled, qualification, contact_id, wa_contacts(phone, name, stage)").eq("id", conversation_id).single();
    if (!conv || !(conv as any).ai_enabled) return new Response(JSON.stringify({ ok: true, skip: "ai disabled" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: cfg } = await admin.from("wa_bot_config").select("*").limit(1).maybeSingle();
    const { data: history } = await admin.from("wa_messages").select("direction, content, created_at").eq("conversation_id", conversation_id).order("created_at", { ascending: true }).limit(40);

    const persona = cfg?.persona ?? "Eres una asesora inmobiliaria cercana.";
    const goals = (cfg?.goals ?? []) as string[];
    const extract = (cfg?.extract_fields ?? []) as string[];
    const forbidden = (cfg?.forbidden ?? []) as string[];
    const qual = (conv as any).qualification ?? {};

    const systemPrompt = `${persona}

OBJETIVOS DE LA CONVERSACIÓN:
${goals.map((g) => `- ${g}`).join("\n")}

DATOS QUE NECESITAS EXTRAER (si aún no los tienes en qualification):
${extract.map((f) => `- ${f}`).join("\n")}

DATOS YA CONOCIDOS: ${JSON.stringify(qual)}

ESTILO:
- Mensajes muy cortos (1-2 frases).
- Sin sonar a script. Variabilidad. Alguna pausa con "...".
- Emoji muy ocasional.
- Nunca digas frases como: ${forbidden.join(", ")}.
- Habla SIEMPRE en español de España, tuteo, tono Chris Voss: empatía táctica, etiquetas ("parece que..."), preguntas calibradas ("¿cómo lograrías...?").

RESPONDE SÓLO con el mensaje a enviar por WhatsApp. Nada de explicaciones.`;

    const messages = [
      { role: "system", content: systemPrompt },
      ...(history ?? []).map((m: any) => ({ role: m.direction === "in" ? "user" : "assistant", content: m.content ?? "" })),
    ];

    // Llamar a Lovable AI Gateway
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({ model: "google/gemini-3-flash-preview", messages, temperature: 0.85 }),
    });
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      return new Response(JSON.stringify({ error: `AI ${aiRes.status}: ${txt}` }), { status: aiRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const aiJson = await aiRes.json();
    const reply: string = (aiJson?.choices?.[0]?.message?.content ?? "").trim();
    if (!reply) return new Response(JSON.stringify({ ok: true, skip: "empty reply" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const phone = (conv as any)?.wa_contacts?.phone;
    const sendRes = await evoFetch(`/message/sendText/${EVOLUTION_INSTANCE}`, {
      method: "POST",
      body: JSON.stringify({ number: phone, text: reply }),
    });

    await admin.from("wa_messages").insert({
      conversation_id,
      contact_id: (conv as any).contact_id,
      direction: "out",
      type: "text",
      content: reply,
      evolution_message_id: sendRes?.key?.id ?? null,
      ai_generated: true,
      metadata: { model: "google/gemini-3-flash-preview" },
    });
    await admin.from("wa_conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conversation_id);
    await admin.from("wa_ai_jobs").update({ status: "done", updated_at: new Date().toISOString() }).eq("conversation_id", conversation_id).eq("status", "pending");

    return new Response(JSON.stringify({ ok: true, reply }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});