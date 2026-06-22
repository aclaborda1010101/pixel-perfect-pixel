// Genera/actualiza wa_conversations.summary con un resumen breve en castellano de España.
// Llamado desde wa_ai_reply (cuando propose_meeting, handoff, o ≥6 msgs nuevos) o manual desde la UI.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { conversation_id, force } = await req.json().catch(() => ({} as any));
    if (!conversation_id) {
      return new Response(JSON.stringify({ error: "conversation_id requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: conv } = await admin
      .from("wa_conversations")
      .select("id, summary, summary_msg_count, qualification, handoff_reason, rol_owner, subrol_owner, wa_contacts(name, phone, stage)")
      .eq("id", conversation_id).single();
    if (!conv) {
      return new Response(JSON.stringify({ error: "conv not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: history } = await admin
      .from("wa_messages")
      .select("direction, content, type, created_at")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: true })
      .limit(120);
    const real = (history ?? []).filter((m: any) => m.type !== "system" && m.content);
    if (real.length === 0) {
      return new Response(JSON.stringify({ ok: true, skip: "no messages" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!force) {
      const since = (conv as any).summary_msg_count ?? 0;
      const newSince = Math.max(0, real.length - since);
      if ((conv as any).summary && newSince < 6) {
        return new Response(JSON.stringify({ ok: true, skip: "not enough new messages", new: newSince }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const contact = (conv as any).wa_contacts;
    const transcript = real
      .map((m: any) => `${m.direction === "in" ? "Lead" : "Lucía"}: ${m.content}`)
      .join("\n");

    const qual = (conv as any).qualification ?? {};
    const handoff = (conv as any).handoff_reason ? `\nHandoff a humano: ${(conv as any).handoff_reason}` : "";
    const rolLine = (conv as any).rol_owner
      ? `\nRol inferido: ${(conv as any).rol_owner}${(conv as any).subrol_owner ? ` / ${(conv as any).subrol_owner}` : ""}`
      : "";

    const systemPrompt = `Eres un asistente del equipo comercial de Afflux Property.
Resume conversaciones de WhatsApp con propietarios para que un comercial las entienda en 10 segundos.
Castellano de España, tuteo opcional, tono profesional pero natural. Máximo 5 líneas.
Usa esta estructura, sin viñetas largas:
- Quién es y qué pidió (1 línea).
- Situación del edificio / datos conocidos (1-2 líneas).
- Temperatura emocional y estado actual (interesado, dudoso, pendiente de llamada, frío, requiere humano…).
- Próximo paso recomendado (1 línea).
No inventes datos que no estén en la conversación.`;

    const userPrompt = `Contacto: ${contact?.name ?? "—"} (${contact?.phone ?? "—"})
Stage actual: ${contact?.stage ?? "nuevo"}${handoff}${rolLine}
Datos extraídos hasta ahora: ${JSON.stringify(qual)}

Transcripción cronológica:
${transcript}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.4,
      }),
    });
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      return new Response(JSON.stringify({ error: `AI ${aiRes.status}: ${txt}` }), {
        status: aiRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const aiJson = await aiRes.json();
    const summary = String(aiJson?.choices?.[0]?.message?.content ?? "").trim();
    if (!summary) {
      return new Response(JSON.stringify({ ok: true, skip: "empty summary" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await admin.from("wa_conversations").update({
      summary,
      summary_updated_at: new Date().toISOString(),
      summary_msg_count: real.length,
    }).eq("id", conversation_id);

    return new Response(JSON.stringify({ ok: true, summary, msg_count: real.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});