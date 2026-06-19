// Genera respuesta del bot con Lovable AI y la envía por Evolution.
// SOLO responde a entrantes. Nunca inicia conversación, no envía plantillas salientes.
import { createClient } from "npm:@supabase/supabase-js@2";
import { evoFetch, EVOLUTION_INSTANCE } from "../_shared/evolution.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HANDOFF_PATTERNS: RegExp[] = [
  /\b(eres|sois)\s+(un\s+)?(bot|robot|chatbot|ia|inteligencia\s+artificial|m[áa]quina|programa|automatismo)\b/i,
  /\b(esto|esta)\s+(es|parece)\s+(un\s+)?(bot|ia|autom[áa]tic[oa]|inteligencia\s+artificial)\b/i,
  /\b(bot|ia|chatbot|inteligencia\s+artificial|autom[áa]tic[oa]|automatismo|robot)\b\??$/i,
  /\b(hablar|contactar|que\s+me\s+llame|pasame|p[áa]same)\s+(con\s+)?(una\s+)?(persona|humano|alguien\s+real|comercial|responsable|encargad[oa])\b/i,
  /\b(quiero|necesito|prefiero)\s+(hablar|tratar)\s+con\s+(una\s+)?(persona|humano|alguien)\b/i,
  /\b(estafa|fraude|spam|tim(o|a)|denunciar|polic[ií]a)\b/i,
  /\bno\s+me\s+(moleste|molestes|escrib[áa]is|llam[eé]is)\b/i,
  /\bdejad?\s+de\s+(escribir|molestar|insistir)\b/i,
  /\bno\s+(me\s+)?(interesa|quiero\s+nada)\b/i,
  /\b(basta|para\s+ya|d[ée]jame\s+en\s+paz)\b/i,
];

function detectHandoff(text: string): { hit: boolean; reason?: string } {
  const t = (text || "").trim();
  if (!t) return { hit: false };
  for (const re of HANDOFF_PATTERNS) if (re.test(t)) return { hit: true, reason: re.source };
  return { hit: false };
}

function madridNow(): { h: number; m: number; ymd: string } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit",
    year: "numeric", month: "2-digit", day: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { h: Number(parts.hour), m: Number(parts.minute), ymd: `${parts.year}-${parts.month}-${parts.day}` };
}

async function sendPresence(phone: string, ms: number) {
  try {
    await evoFetch(`/chat/sendPresence/${EVOLUTION_INSTANCE}`, {
      method: "POST",
      body: JSON.stringify({ number: phone, delay: ms, presence: "composing" }),
    });
  } catch { /* presence es opcional */ }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { conversation_id } = await req.json();
    if (!conversation_id) {
      return new Response(JSON.stringify({ error: "conversation_id requerido" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: conv } = await admin
      .from("wa_conversations")
      .select("id, ai_enabled, qualification, contact_id, wa_contacts(id, phone, name, stage)")
      .eq("id", conversation_id).single();
    if (!conv) {
      return new Response(JSON.stringify({ error: "conversation not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const contact = (conv as any).wa_contacts;
    if (!(conv as any).ai_enabled || contact?.stage === "handoff") {
      return new Response(JSON.stringify({ ok: true, skip: "ai disabled or handoff" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: cfg } = await admin.from("wa_bot_config").select("*").limit(1).maybeSingle();
    const { data: history } = await admin
      .from("wa_messages")
      .select("direction, content, type, created_at, metadata")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: true })
      .limit(60);

    const realHistory = (history ?? []).filter((m: any) => m.type !== "system" && m.content);
    const lastIn = [...realHistory].reverse().find((m: any) => m.direction === "in");
    const lastInText: string = lastIn?.content ?? "";

    // Si el último mensaje entrante es multimedia aún no procesado, NO respondemos.
    // wa_process_incoming_media disparará wa_ai_reply al terminar.
    const lastInMeta = (lastIn as any)?.metadata?.media;
    if (lastInMeta && lastInMeta.processing === "pending") {
      return new Response(JSON.stringify({ ok: true, skip: "media pending" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) HANDOFF: si el lead pregunta por bot/IA, se enfada o pide humano → parar y avisar.
    const handoff = detectHandoff(lastInText);
    if (handoff.hit) {
      const reason = `Detectado patrón "${handoff.reason}" en: "${lastInText.slice(0, 160)}"`;
      await admin.from("wa_conversations").update({ ai_enabled: false, handoff_reason: reason }).eq("id", conversation_id);
      await admin.from("wa_contacts").update({ stage: "handoff" }).eq("id", contact.id);
      await admin.from("wa_messages").insert({
        conversation_id,
        contact_id: contact.id,
        direction: "out",
        type: "system",
        content: "⚠️ Handoff automático: el lead pregunta por humano/bot, está incómodo o pide parar. Bot pausado, pendiente de comercial.",
        ai_generated: false,
        metadata: { handoff: true, trigger: lastInText.slice(0, 240), pattern: handoff.reason },
      });
      await admin.from("wa_ai_jobs").update({ status: "done", updated_at: new Date().toISOString() })
        .eq("conversation_id", conversation_id).eq("status", "pending");
      // Forzar resumen tras handoff
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa_summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ conversation_id, force: true }),
      }).catch(() => {});
      return new Response(JSON.stringify({ ok: true, handoff: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) ACTIVE HOURS (Europe/Madrid)
    const ah = (cfg as any)?.active_hours ?? { from: "09:00", to: "21:00" };
    const fromH = Number(String(ah.from || "09:00").split(":")[0]) || 9;
    const toH   = Number(String(ah.to   || "21:00").split(":")[0]) || 21;
    const { h: nowH } = madridNow();
    const inHours = nowH >= fromH && nowH < toH;
    if (!inHours) {
      // Si el usuario insiste mucho (≥3 entrantes seguidos sin respuesta nuestra), mandar off_hours_message una vez.
      let incomingStreak = 0;
      for (let i = realHistory.length - 1; i >= 0; i--) {
        if (realHistory[i].direction === "in") incomingStreak++;
        else break;
      }
      const lastOffHoursSent = [...realHistory].reverse().find((m: any) => m.direction === "out");
      const offMsg: string = (cfg as any)?.off_hours_message ?? "Te respondo mañana sin falta 🙌";
      const alreadyToldTonight = lastOffHoursSent && (Date.now() - new Date(lastOffHoursSent.created_at).getTime()) < 8 * 60 * 60 * 1000;
      if (incomingStreak >= 3 && offMsg && !alreadyToldTonight) {
        await sendPresence(contact.phone, 1800);
        await sleep(2000);
        const sendRes = await evoFetch(`/message/sendText/${EVOLUTION_INSTANCE}`, {
          method: "POST",
          body: JSON.stringify({ number: contact.phone, text: offMsg }),
        });
        await admin.from("wa_messages").insert({
          conversation_id, contact_id: contact.id,
          direction: "out", type: "text", content: offMsg, ai_generated: true,
          evolution_message_id: sendRes?.key?.id ?? null,
          metadata: { off_hours: true },
        });
      }
      await admin.from("wa_ai_jobs").update({ status: "deferred", updated_at: new Date().toISOString() })
        .eq("conversation_id", conversation_id).eq("status", "pending");
      return new Response(JSON.stringify({ ok: true, off_hours: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3) Playbook Voss (mejores tácticas registradas)
    let vossSnippets: string[] = [];
    try {
      const { data: pb } = await admin
        .from("call_playbook")
        .select("tactica_tipo, tactica_texto, ejemplo_literal")
        .order("tasa_exito", { ascending: false, nullsFirst: false })
        .limit(5);
      vossSnippets = (pb ?? []).map((p: any) =>
        `- ${p.tactica_tipo}/${p.tactica_texto}${p.ejemplo_literal ? `: "${p.ejemplo_literal}"` : ""}`
      );
    } catch { /* opcional */ }

    const persona = (cfg as any)?.persona ?? "Eres Lucía, del equipo de Afflux Property.";
    const goals = ((cfg as any)?.goals ?? []) as string[];
    const extractFields = ((cfg as any)?.extract_fields ?? []) as string[];
    const forbidden = ((cfg as any)?.forbidden ?? []) as string[];
    const qual = ((conv as any).qualification ?? {}) as Record<string, any>;

    const systemPrompt = `${persona}

CONTEXTO REAL (NO LO OLVIDES):
- Este lead nos ha escrito ÉL primero, tras ver una campaña de Afflux Property.
- Tú NUNCA inicias conversación, SOLO respondes a lo que él escribe.
- Castellano de España, tuteo. Una sola pregunta por mensaje.
- Eres del equipo comercial, en Madrid.

ESTILO CHRIS VOSS (método interno):
- Empatía táctica: etiqueta lo que percibes en el otro ("parece que…", "da la sensación de que…", "tiene pinta de que…").
- Preguntas calibradas: "¿cómo…?", "¿qué te haría falta para…?", "¿qué es lo más importante para ti en esto?".
- Espejos: repite ocasionalmente las 1-3 últimas palabras del otro como pregunta.
- Etiqueta emociones antes de pedir nada.
- Nunca presiones. Si notas duda, valida y baja el ritmo.
Ejemplos del playbook del equipo:
${vossSnippets.join("\n") || "- (sin ejemplos cargados)"}

OBJETIVO DE LA CONVERSACIÓN:
${goals.map((g) => `- ${g}`).join("\n")}
Cuando haya algo de rapport y al menos 1-2 datos, propón de forma natural una breve llamada o visita con el equipo. Sin forzar.

MULTIMEDIA:
- Si en el historial ves mensajes que empiezan por "🎤 Audio (transcrito):", "🖼️ Imagen (descripción):" o "📄 Documento (resumen):", esos son mensajes REALES del lead que tú ya has "escuchado/visto". Trátalos como información válida que la persona te ha dado.
- NUNCA digas "no puedo escuchar audios" ni pidas que repita por escrito; ya tienes la transcripción.
- NO repitas una pregunta cuya respuesta esté ya en una transcripción o descripción anterior. Si el dato ya aparece, dalo por sabido y avanza.

DATOS QUE NECESITAS IR SACANDO (encajados en la charla, NO como cuestionario, y SOLO si no los tienes ya):
${extractFields.map((f) => `- ${f}`).join("\n")}

DATOS YA CONOCIDOS (NO los vuelvas a preguntar): ${JSON.stringify(qual)}

REGLAS DURAS:
- Nunca digas frases como: ${forbidden.join(" / ")}.
- Si te preguntan si eres bot/IA/automático, NO mientas y NO afirmes que eres humano. (El sistema lo gestiona aparte parando la conversación; tú simplemente no respondas afirmando ser humano).
- Una sola pregunta por mensaje.
- Mensajes MUY cortos (1-2 frases). Puedes dividir en 1-3 mensajes seguidos como haría una persona escribiendo por WhatsApp.
- Nada de listas, bullets, ni textos largos.

DEVUELVES SIEMPRE un JSON con esta forma EXACTA y nada más:
{
  "messages": ["...", "..."],
  "qualification_update": {
    "nombre_apellidos"?: string,
    "gestiona_edificio"?: "si" | "no",
    "tiene_cuadro_rentas"?: "si" | "no",
    "vive_en_edificio"?: "si" | "no",
    "relacion_copropietarios"?: string
  },
  "propose_meeting": boolean
}
En "qualification_update" SOLO incluyes campos que hayas podido deducir con seguridad de lo que la persona ha dicho; si no se sabe, omítelo. No inventes.`;

    const aiMessages = [
      { role: "system", content: systemPrompt },
      ...realHistory.map((m: any) => ({
        role: m.direction === "in" ? "user" : "assistant",
        content: m.content,
      })),
    ];

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOVABLE_API_KEY}` },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: aiMessages,
        temperature: 0.85,
        response_format: { type: "json_object" },
      }),
    });
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      return new Response(JSON.stringify({ error: `AI ${aiRes.status}: ${txt}` }), {
        status: aiRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const aiJson = await aiRes.json();
    const raw = String(aiJson?.choices?.[0]?.message?.content ?? "").trim();
    let parsed: any = {};
    try { parsed = JSON.parse(raw); }
    catch { parsed = { messages: [raw], qualification_update: {}, propose_meeting: false }; }

    const replyMsgs: string[] = Array.isArray(parsed.messages)
      ? parsed.messages.filter((s: any) => typeof s === "string" && s.trim()).slice(0, 3)
      : [];
    if (replyMsgs.length === 0) {
      return new Response(JSON.stringify({ ok: true, skip: "empty reply" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Anti-duplicado: si el bot acaba de mandar literalmente lo mismo en los últimos 5 minutos,
    // no repitas. Evita los bucles "Da la sensación de que..." vistos en producción.
    const recentOuts = realHistory
      .filter((m: any) => m.direction === "out")
      .slice(-6)
      .map((m: any) => String(m.content || "").trim().toLowerCase());
    const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
    const filteredReply = replyMsgs.filter((m) => !recentOuts.includes(norm(m)));
    if (filteredReply.length === 0) {
      await admin.from("wa_ai_jobs").update({ status: "skipped_dup", updated_at: new Date().toISOString() })
        .eq("conversation_id", conversation_id).eq("status", "pending");
      return new Response(JSON.stringify({ ok: true, skip: "duplicate of recent reply" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const finalReplies = filteredReply;

    // Merge qualification (sin sobrescribir lo ya conocido, solo añadir nuevos)
    const qu = parsed.qualification_update ?? {};
    const allowed = ["nombre_apellidos", "gestiona_edificio", "tiene_cuadro_rentas", "vive_en_edificio", "relacion_copropietarios"];
    const cleanQu: Record<string, any> = {};
    for (const k of allowed) {
      const v = qu?.[k];
      if (v == null) continue;
      if (qual[k] != null && qual[k] !== "") continue;
      if (typeof v === "string" && v.trim()) cleanQu[k] = v.trim();
    }
    const newQual = { ...qual, ...cleanQu };
    if (Object.keys(cleanQu).length > 0) {
      await admin.from("wa_conversations").update({ qualification: newQual }).eq("id", conversation_id);
    }

    // 4) TIEMPOS HUMANOS: delay total + presence typing + 1-3 mensajes con micro pausas
    const minS = (cfg as any)?.reply_delay_min ?? 8;
    const maxS = (cfg as any)?.reply_delay_max ?? 45;
    const totalMs = Math.floor((minS + Math.random() * Math.max(1, maxS - minS)) * 1000);
    const perMsg = Math.floor(totalMs / Math.max(1, finalReplies.length));

    for (let i = 0; i < finalReplies.length; i++) {
      const m = finalReplies[i];
      const typingMs = Math.max(1500, Math.min(perMsg - 600, 12000));
      await sendPresence(contact.phone, typingMs);
      await sleep(typingMs);
      const sendRes = await evoFetch(`/message/sendText/${EVOLUTION_INSTANCE}`, {
        method: "POST",
        body: JSON.stringify({ number: contact.phone, text: m }),
      });
      await admin.from("wa_messages").insert({
        conversation_id,
        contact_id: contact.id,
        direction: "out",
        type: "text",
        content: m,
        evolution_message_id: sendRes?.key?.id ?? null,
        ai_generated: true,
        metadata: {
          model: "google/gemini-3-flash-preview",
          part: i + 1, of: finalReplies.length,
          qualification_update: cleanQu,
          propose_meeting: !!parsed.propose_meeting,
        },
      });
      if (i < finalReplies.length - 1) await sleep(700 + Math.floor(Math.random() * 1600));
    }

    await admin.from("wa_conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conversation_id);
    await admin.from("wa_ai_jobs").update({ status: "done", updated_at: new Date().toISOString() })
      .eq("conversation_id", conversation_id).eq("status", "pending");

    // Auto-avance de stage suave
    const currentStage = contact.stage ?? "nuevo";
    if (currentStage === "nuevo") {
      await admin.from("wa_contacts").update({ stage: "conversando" }).eq("id", contact.id);
    }
    const filled = allowed.filter((k) => newQual[k]).length;
    if (filled >= 4 && currentStage !== "cualificado" && currentStage !== "caliente" && currentStage !== "handoff") {
      await admin.from("wa_contacts").update({ stage: "cualificado" }).eq("id", contact.id);
    }

    // Resumen: en momentos clave (propuesta de reunión) o cuando haya ≥6 mensajes nuevos
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa_summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
      body: JSON.stringify({ conversation_id, force: !!parsed.propose_meeting }),
    }).catch(() => {});

    return new Response(JSON.stringify({
      ok: true, sent: finalReplies.length, qualification_update: cleanQu, propose_meeting: !!parsed.propose_meeting,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});