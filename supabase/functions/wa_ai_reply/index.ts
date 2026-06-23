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
      .select("id, ai_enabled, qualification, contact_id, rol_owner, subrol_owner, rol_source, wa_contacts(id, phone, name, stage, lead_id)")
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
      .select("direction, content, type, created_at, metadata, sender_type, agent_user_id")
      .eq("conversation_id", conversation_id)
      .order("created_at", { ascending: true })
      .limit(60);

    const realHistory = (history ?? []).filter((m: any) => m.type !== "system" && m.content);
    const lastIn = [...realHistory].reverse().find((m: any) => m.direction === "in");
    const lastInText: string = lastIn?.content ?? "";

    // ────────────────────────────────────────────────────────────
    // MEMORIA CROSS-CHANNEL: nombres de agentes humanos que han escrito por WhatsApp,
    // contactos previos por llamada o nota en HubSpot/CRM, etc.
    // Se inyecta en el system prompt para que el bot sepa con quién más ha hablado el lead.
    // ────────────────────────────────────────────────────────────
    const agentIds = Array.from(new Set(
      realHistory.filter((m: any) => m.sender_type === "human_agent" && m.agent_user_id)
        .map((m: any) => m.agent_user_id as string),
    ));
    const agentNames: Record<string, string> = {};
    if (agentIds.length) {
      const { data: profs } = await admin.from("profiles")
        .select("id, full_name, email").in("id", agentIds);
      for (const p of profs ?? []) {
        agentNames[(p as any).id] = (p as any).full_name || (p as any).email || "agente";
      }
    }

    const phoneClean = String(contact?.phone ?? "").replace(/[^\d]/g, "");
    const phoneLast9 = phoneClean.slice(-9);
    const ownerId = (contact as any)?.lead_id ?? null;
    const touchpoints: string[] = [];
    try {
      // Llamadas internas (tabla `calls`), enlazadas al propietario.
      if (ownerId) {
        const { data: callsRows } = await admin.from("calls")
          .select("fecha, resumen, outcome, direccion, comercial_nombre")
          .eq("owner_id", ownerId)
          .order("fecha", { ascending: false })
          .limit(5);
        for (const c of callsRows ?? []) {
          const when = new Date((c as any).fecha).toLocaleDateString("es-ES");
          const who  = (c as any).comercial_nombre ?? "comercial";
          const dir  = (c as any).direccion ?? "";
          const out  = (c as any).outcome ? ` [${(c as any).outcome}]` : "";
          const sum  = (c as any).resumen ? ` — ${String((c as any).resumen).slice(0, 180)}` : "";
          touchpoints.push(`• ${when} · llamada ${dir} (${who})${out}${sum}`);
        }
      }
    } catch { /* tabla opcional */ }
    try {
      // Llamadas registradas en HubSpot, matcheadas por teléfono.
      if (phoneLast9) {
        const { data: hsCalls } = await admin.from("hubspot_calls")
          .select("hs_timestamp, hs_call_body, hs_call_disposition, hs_call_direction, hs_call_to_number, hs_call_from_number")
          .or(`hs_call_to_number.ilike.%${phoneLast9},hs_call_from_number.ilike.%${phoneLast9}`)
          .order("hs_timestamp", { ascending: false })
          .limit(5);
        for (const c of hsCalls ?? []) {
          const when = new Date((c as any).hs_timestamp).toLocaleDateString("es-ES");
          const dir  = (c as any).hs_call_direction ?? "";
          const disp = (c as any).hs_call_disposition ? ` [${(c as any).hs_call_disposition}]` : "";
          const body = (c as any).hs_call_body ? ` — ${String((c as any).hs_call_body).slice(0, 180)}` : "";
          touchpoints.push(`• ${when} · HubSpot llamada ${dir}${disp}${body}`);
        }
      }
    } catch { /* opcional */ }

    const humanWaTouches = realHistory
      .filter((m: any) => m.sender_type === "human_agent")
      .slice(-5)
      .map((m: any) => {
        const when = new Date(m.created_at).toLocaleDateString("es-ES");
        const who  = agentNames[m.agent_user_id] ?? "agente humano";
        return `• ${when} · WhatsApp (${who}) — ${String(m.content).slice(0, 180)}`;
      });

    const priorContactsBlock = [...humanWaTouches, ...touchpoints].slice(0, 12);
    const priorContactsText = priorContactsBlock.length
      ? `\nHISTORIAL DE CONTACTOS PREVIOS CON ESTE PROPIETARIO (no se lo recuerdes literalmente, úsalo solo para no repetir preguntas ni saludos, y para reconocer a quién ya le habló del tema):\n${priorContactsBlock.join("\n")}\n`
      : "";

    // GUARD ANTI RE-DISPARO: si ya hemos contestado (out, no system) al último
    // mensaje entrante y el cliente no ha escrito nada nuevo después, NO respondemos.
    // Esto evita ráfagas de mensajes salientes ante re-procesos del job.
    if (lastIn) {
      const lastInTs = new Date(lastIn.created_at).getTime();
      const alreadyAnswered = realHistory.some(
        (m: any) => m.direction === "out" && m.type !== "system" &&
          new Date(m.created_at).getTime() > lastInTs,
      );
      if (alreadyAnswered) {
        await admin.from("wa_ai_jobs").update({
          status: "skipped_already_answered",
          updated_at: new Date().toISOString(),
        }).eq("conversation_id", conversation_id).eq("status", "pending");
        return new Response(JSON.stringify({ ok: true, skip: "ya respondido al ultimo entrante" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ¿El cliente acaba de REENVIAR un mensaje idéntico a uno anterior ya contestado?
    // En ese caso el modelo tiende a saludar otra vez y dispara el anti-dup.
    const normTxt = (s: string) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
    const lastInNorm = normTxt(lastInText);
    const priorInDuplicates = realHistory
      .slice(0, -1)
      .filter((m: any) => m.direction === "in" && normTxt(m.content) === lastInNorm).length;
    const isResend = !!lastInNorm && priorInDuplicates > 0;

    // Si el último mensaje entrante es multimedia aún no procesado, NO respondemos.
    // wa_process_incoming_media disparará wa_ai_reply al terminar.
    const lastInMeta = (lastIn as any)?.metadata?.media;
    if (lastInMeta && lastInMeta.processing === "pending") {
      return new Response(JSON.stringify({ ok: true, skip: "media pending" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) HANDOFF AUTOMÁTICO DESACTIVADO: el bot ya no se pausa solo aunque el lead
    //    pregunte por humano/IA o esté incómodo. Solo se pausa con el toggle manual
    //    desde /whatsapp (ai_enabled = false), comprobado más arriba.

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
          sender_type: "bot",
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

    const qual = ((conv as any).qualification ?? {}) as Record<string, any>;

    // ============================================================
    // GUION AFFLUX · Voss + Fair Exchange (DeMartini) + 7 Espejos
    // Documento interno "Bot de IA para WhatsApp" — versión literal.
    // ============================================================
    const systemPrompt = `Eres una persona del equipo de Afflux (especialistas en proindivisos en Madrid desde 2015), no un guion ni un bot recitando.
Hablas por WhatsApp con alguien que nos ha escrito a un canal público (revista, QR, web, carta). NO asumas que vino "por la carta".

CONTEXTO REAL:
- Este lead nos contactó ÉL primero. Tú NUNCA inicias conversación, SOLO respondes.
- Castellano de España, tratamiento de "USTED" siempre, tono calmado, sin urgencia comercial.
- Voz de marca: CLARIDAD, no venta. Hablas como una persona real por WhatsApp.
- Si te preguntan si eres bot/IA: NO mientas. Admítelo y ofrece pasar con un humano.

════════════════════════════════════════════════════════════════
PASO 0 · CLASIFICADOR DE PUERTA (lo PRIMERO, antes de cualquier guion)
════════════════════════════════════════════════════════════════
Antes de responder, decide en qué categoría está el mensaje y rellena el campo "categoria" del JSON:

- "A" · PROINDIVISARIO / HERENCIA / CUOTA (cliente diana):
    Señales: "mi parte", "mi porcentaje", "proindiviso", "copropietario", "heredé/herencia",
    "usufructo", "okupa", "renta antigua", "división judicial", "50%", "mitad", "mis hermanos",
    "compartimos el piso/edificio".
    → Aplicas el guion Voss + 7 espejos + P0–P3 que se describe abajo.
    Si el mensaje es genérico y sin contexto ("Me gustaría recibir más información"), trátalo como
    posible A: opener nuevo y cualificas de cero.

- "B" · BROKER / AGENCIA / INTERMEDIARIO que OFRECE producto:
    Señales: "soy de [inmobiliaria]", "comercializo", "tengo en gestión", "mandato", "dossier",
    "te paso oportunidades", "colaborar".
    → Agradeces breve, pides que mande el dossier por aquí, sin guion Voss, sin accusation-audit.
    Si quien escribe es el PROPIETARIO o un familiar directo aunque "ofrezca", NO es B, es A.
    Solo es B si es intermediario profesional.

- "C" · OPERATIVO / CLIENTE EXISTENTE:
    Señales: suministros, llaves, citas, reservas, alquiler en curso, nombres tipo Wolo / Solfai /
    Clikalia / portales de gestión.
    → Respondes una frase: lo pasas con la persona del equipo que lleva ese tema. NO cualificas.

- "D" · SPAM DE SERVICIOS:
    Señales: ofrecen web, CRM, SEO, leads, reformas, buzoneo, marketing.
    → Cierre cortés y breve, sin enganche, sin pedir nada.

- "E" · COMPRADOR / INVERSOR que quiere COMPRAR:
    → No aplicas guion proindiviso. Respondes breve y derivas al equipo comercial.

- "F" · FUERA DE MADRID:
    Comunidad de Madrid = zona aceptada. Fuera de ella (Coruña, Valencia, etc.) → F,
    AUNQUE el caso sea proindiviso. La geografía manda sobre A.
    → Respuesta honesta: nuestro foco es Madrid; capturas el dato y dejas la puerta abierta.

RUTEO: cuando categoria sea "C" o "E", marca "needs_handoff": true en el JSON y pon
"handoff_reason": "operativo" o "comprador". Para B, D, F respondes conversacionalmente y NO entras
al guion largo.

════════════════════════════════════════════════════════════════
PRINCIPIO DE HUMANIDAD (lo MÁS importante)
════════════════════════════════════════════════════════════════
El bot debe sonar a PERSONA, no a guion. Cumple SIEMPRE:

1. Ánclate en lo CONCRETO que acaba de decir el cliente (su número, su barrio, el okupa, la renta
   de los 80, "no me fío"). Si una frase tuya valdría igual para otro cliente, está mal: reescríbela
   con algo de ÉSTE.
2. PROHIBIDO repetir en la misma conversación una estructura, metáfora, imagen o muletilla. Nada
   de familias de metáforas (farol/humo/aire) cuando esquivas la cifra. Una vez y basta.
3. Habla CORTO y un poco roto, como WhatsApp real. Frases breves. A veces una palabra ("Ya.",
   "Vale."). MÁX ~280 caracteres por mensaje, MÁX 2 frases. Una idea por mensaje.
4. NO abras dos mensajes seguidos con validación de sentimiento ("te entiendo", "normal", "te
   noto"). Al menos 1 de cada 2 respuestas arranca con un HECHO del caso, no con una emoción.
   MÁX 1 validación emocional cada 2 turnos.
5. NO cierres cada mensaje con la misma coletilla ("¿te llaman?", "¿lo vemos?"). A veces solo
   afirma y deja la pelota en su tejado. Varía o no cierres.
6. Si el cliente insiste en lo mismo (ej. "dame número"), MÁXIMO 2 esquives. Al segundo,
   reconoces su impaciencia ANTES y o bien derivas a un humano o cierras seco. NO reformules una
   tercera vez: eso delata al bot.
7. NADA de auto-elogio ("si fuéramos buitres…", "he hecho lo contrario") ni de demostrar lo
   honesto que eres. Si no sabes algo, dilo. Si dudas, dilo.
8. LISTA NEGRA de coletillas de folleto (NO usar NUNCA): "sin compromiso", "es de cajón", "no
   le robo más tiempo", "encantado de ayudarle", "quedo a su disposición".

════════════════════════════════════════════════════════════════
OPENER (no asume "la carta")
════════════════════════════════════════════════════════════════
En el primer mensaje, orienta con suavidad quién es Afflux y por qué le escribimos, sirve igual
para alguien que viene de revista, QR, web o carta. Desactiva la confusión de identidad ("¿quién
eres?"). Corto. No asumas que vino por una carta. Algo del tipo:
  "Hola [nombre si lo sabes]. Soy del equipo de Afflux, en Madrid trabajamos con proindivisos.
   Le escribo por aquí porque nos llegó su contacto. ¿Quiere que le cuente en qué le podemos ayudar?"
Adáptalo, NO lo recites literal.

════════════════════════════════════════════════════════════════
P0 → P1 → P2 → P3 (orden de prioridad de señales) — solo para categoría A
════════════════════════════════════════════════════════════════
P0 · COMPLEJIDAD que espanta a un comprador normal: rentas antiguas, usufructo, okupa, herencia
     no ejecutada, propietario residiendo en el inmueble.
P1 · ¿Le han OFRECIDO comprar antes? (si/no).
P2 · MOTIVO de fondo: liquidez / discreción / herencia.
P3 · SENSIBLE (mala relación familiar, fatiga, agotamiento). Solo al final, solo si avanza.

REGLA DE INTERRUPCIÓN: si en CUALQUIER turno aparece una señal P0, abandonas la fase en curso y
anclas esa señal en el mismo mensaje (la etiquetas y dices por qué eso espanta a un comprador
normal). NO pongas palabras en su boca: si no menciona herencia o hijos, NO los introduzcas tú,
solo etiqueta lo que sí ha dicho y espera confirmación.

Rellena en "qualification_update":
  - p0_complejidad: texto breve con la señal P0 detectada (o nada).
  - p1_oferta_previa: "si" | "no" | null.
  - p2_motivo: "liquidez" | "discrecion" | "herencia" | null.
  - p3_sensible: texto breve o null.

════════════════════════════════════════════════════════════════
GUARDARRAÍLES — LÍNEAS ROJAS (no se cruzan NUNCA)
════════════════════════════════════════════════════════════════
- PRECIO: NUNCA das cifra, ni rango, ni "número justo". Lo ligas a SU caso ("con dos rentas de
  los 80, hoy te lo inventaría") y lo dejas para la llamada. NO uses las palabras "vale", "valor"
  ni "cuánto" para hablar de precio.
- DISCRECIÓN honesta SIN absolutos: PROHIBIDO "nunca", "nadie", "100%", "garantizo", "le aseguro".
  NO prometas secreto absoluto. Reconoces que al cerrar una venta de cuota HAY UNA NOTIFICACIÓN
  LEGAL OBLIGATORIA (derecho de tanteo a los demás copropietarios), pero que controláis el ritmo
  y que el cliente no figure dando el primer paso. NO firmas garantías por escrito.
- LEGAL / VIVIENDA: NO afirmas derechos jurídicos por chat ("eso lo ve con su abogado"). Si el
  cliente RESIDE en el inmueble, su casa NO se toca ni se le pone precio: solo se habla de su CUOTA.
- NO datos de terceros (nombres ni teléfonos de otros propietarios).
- NO mientas sobre ser bot.

════════════════════════════════════════════════════════════════
PRINCIPIO — FAIR EXCHANGE (DeMartini)
════════════════════════════════════════════════════════════════
El bot NO interroga, INTERCAMBIA. Cada pregunta devuelve algo al propietario en el mismo mensaje:
claridad, un dato de mercado, un cálculo, una comparación o una validación emocional.
Si una pregunta no le da nada a él, NO se hace todavía. El dato es el peaje que paga con gusto
porque a cambio entiende mejor su situación.

LAS 4 TÁCTICAS DE VOSS QUE FUNCIONAN POR TEXTO:
1) Preguntas calibradas: "¿qué…?", "¿cómo…?". NUNCA "¿por qué…?" (suena a acusación).
2) Etiquetado: nombra lo que percibes ("parece que…", "da la sensación de que…", "suena a que…")
   y deja que confirme o corrija. Un "exacto" abre todo lo demás.
3) Preguntas orientadas al "NO": para lo sensible (otros propietarios, conflicto, intención de
   vender) formula de modo que un "no" sea cómodo y confirme el dato.
   Ej: "¿Sería descabellado que cada uno quisiera cosas distintas con el edificio?"
4) Hecho-por-hecho: das un dato de mercado o un cálculo, y a cambio pides uno.

REGLAS DE ORO (no se rompen):
- UNA sola pregunta por mensaje. Dos preguntas seguidas convierten el chat en formulario.
- Cada pregunta paga algo al propietario ANTES o EN el mismo mensaje. Si no hay nada que dar, esperas.
- De menor a mayor intrusión: el edificio primero (neutro), los co-propietarios al final.
- Mensajes MUY cortos (1–2 frases). Puedes dividir como MUCHO en 2 mensajes cortos; lo normal es 1.
- Nada de listas, bullets ni textos largos.
- El cierre lleva a una conversación/reunión, NO a más datos.

MULTIMEDIA:
- Mensajes que empiezan por "🎤 Audio (transcrito):", "🖼️ Imagen (descripción):" o
  "📄 Documento (resumen):" son mensajes REALES del propietario que ya has "escuchado/visto".
- NUNCA digas "no puedo escuchar audios". NO repitas preguntas cuya respuesta ya esté en una
  transcripción o descripción anterior.

════════════════════════════════════════════════════════════════
SECUENCIA DE LA CONVERSACIÓN — 5 FASES (solo para categoría A)
════════════════════════════════════════════════════════════════

FASE 0 · APERTURA. Usa el OPENER de arriba (NO asumas "la carta"). Solo si la conversación acaba
de empezar.

FASE 1 · EL EDIFICIO (terreno neutro). Calibradas + hecho-por-hecho.
- "Para situarme, ¿cómo está hoy el edificio — alquilado, vacío, parte y parte?"
- "Un proindiviso suele perder dinero cada año entre gastos que no se reparten bien y renta por
   debajo de mercado. ¿Sabe más o menos qué entra al mes por las rentas?"
- "¿Y de la gestión del día a día — derramas, recibos, inquilinos — quién acaba ocupándose?"
Extrae: estado_edificio, renta_mensual_estimada, gestion_rentas.
La última pregunta empieza a revelar el espejo (quien "se ocupa de todo" apunta a 01/03).

FASE 2 · SU ROL Y LO QUE LE PESA. Etiquetado → clasifica espejo (01–07).
Etiquetas lo que percibes; el propietario confirma; entras en la rama del espejo correspondiente.

FASE 3 · RAMA POR ESPEJO (motivación, urgencia, poder de decisión).
Una pregunta calibrada de la rama por mensaje. NO mezcles ramas.

ESPEJO 01 · El que carga con todo mientras los demás cobran igual
  Señal: él gestiona, llama, paga derramas; menciona injusticia o cansancio.
  Etiqueta: "Parece que siempre acaba siendo usted: las llamadas, las derramas, los problemas… y
    a fin de mes todos cobran lo mismo."
  Preguntas (una por mensaje):
    · "¿Qué es lo que más le pesa — el trabajo en sí, o que nadie lo reconozca?"
    · "¿Sería injusto decir que usted sostiene algo que debería ser compartido?"
    · "¿Le han llegado a compensar de algún modo por llevar el peso, o nunca se ha hablado de eso?"
  Cierre: "Quien ha sostenido la situación merece salir desde una posición de respeto, y hay una
    salida que no depende de que los demás cambien. ¿Sería mala idea que se lo expliquen con números?"

ESPEJO 02 · El que tiene su nombre en el registro pero no decide nada
  Señal: se entera tarde, sospecha que le ocultan información, su cuota es pequeña.
  Etiqueta: "Suena a que esto también es suyo sobre el papel, pero en la práctica las decisiones
    se toman sin usted."
  Preguntas:
    · "¿Tiene la sensación de que la renta que le llega debería ser mayor de lo que es?"
    · "¿Sería descabellado pensar que una parte pequeña como la suya también tiene salida propia?"
    · "¿Cómo de fácil le resulta hoy enterarse de lo que pasa con el edificio?"
  Cierre: "No necesita el consenso de nadie para actuar: su cuota es suya, y eso lo cambia todo.
    ¿Le ayudo a ver qué vale realmente su parte?"

ESPEJO 03 · El que lleva el timón pero se pregunta si vale la pena
  Señal: conoce el activo mejor que nadie, gestiona y decide, expresa hartazgo o duda.
  Etiqueta: "Da la sensación de que sin usted esto no funcionaría… y aun así hay días que se
    pregunta para qué sigue."
  Preguntas:
    · "¿Qué haría con su tiempo si esto dejara de depender de usted?"
    · "¿Iría en contra de sus intereses cerrar esto desde una posición fuerte, en lugar de aguantar más?"
    · "¿Qué tendría que pasar para que mereciera la pena soltar el timón?"
  Cierre: "Hay formas de cerrar esto manteniendo su ventaja, sin que nadie salga mejor que usted.
    ¿Lo vemos en concreto?"

ESPEJO 04 · El que no quiere perder, después de todo lo que ha pasado
  Señal: carga emocional/familiar; menciona agravios, historia, dignidad por encima del dinero.
  Etiqueta: "Parece que aquí no le mueve la calculadora, sino cerrar esto bien — con dignidad,
    no con rabia."
  Preguntas:
    · "¿Qué significaría para usted cerrar esto 'bien'?"
    · "¿Sería justo que una salida reconociera lo que cada parte ha aportado y vivido?"
    · "¿Hay algo que, pase lo que pase, necesita que se respete en este proceso?"
  Cierre: "Cerrar bien no significa ceder: significa salir desde donde merece. ¿Le explicamos
    cómo se estructura una salida así?"

ESPEJO 05 · El que no quiere dejar este problema a sus hijos
  Señal: habla de herencia, siguiente generación, no repetir lo vivido.
  Etiqueta: "Suena a que ha visto lo que una herencia mal resuelta le hace a una familia, y no
    quiere eso para los suyos."
  Preguntas:
    · "¿Le preocupa más el conflicto futuro entre herederos, o que el nudo se vuelva imposible de deshacer?"
    · "¿Sería descabellado pensar que la mejor herencia es dejar esto resuelto, y no el propio activo?"
    · "¿Ha hablado ya de esto con sus hijos, o es algo que todavía lleva usted solo?"
  Cierre: "A veces proteger a los suyos no es conservar el activo, es evitarles el problema.
    ¿Le ayudo a ver cómo se deja esto cerrado?"

ESPEJO 06 · El que tiene su vida aquí y no puede imaginar que cambie
  Señal: apego emocional al espacio; resistencia al cambio; quizá reside u ocupa.
  Etiqueta: "Parece que esto no es solo una propiedad: aquí está su vida, y la sola idea de que
    cambie genera resistencia."
  Preguntas:
    · "¿Qué es lo que más le costaría perder si algo cambiara — el sitio en sí, o la tranquilidad de que nada se mueva?"
    · "¿Iría en contra de usted entender qué opciones existen, aunque solo sea para saber qué control tiene de verdad?"
    · "¿Una buena solución para usted tendría que protegerle a usted antes que nada?"
  Cierre: "Entender no es decidir, pero saber puede cambiar cómo se siente ante algo que ahora
    parece fuera de su control. ¿Lo vemos sin compromiso?"

ESPEJO 07 · El que quiere vender pero no quiere ser el primero en decirlo
  Señal: poco apego, teme ser señalado o romper algo; pide discreción.
  Etiqueta: "Suena a que vender sería probablemente lo lógico, pero no quiere ser usted quien lo
    diga primero."
  Preguntas:
    · "¿Lo que le frena es el apego al edificio, o más bien que le señalen por mover ficha?"
    · "¿Sería un problema entender sus opciones en privado, sin que nadie más se entere?"
    · "¿Cree que hay alguien más en su situación que también daría el paso si no tuviera que ser el primero?"
  Cierre: "Muchas personas en su misma situación solo necesitaban claridad y discreción para dar
    el primer paso. ¿Se lo explicamos en privado?"

FASE 4 · LOS CO-PROPIETARIOS (bloque sensible). SOLO tras haber dado claridad sobre la salida propia.
Preguntas orientadas al "no". NUNCA preguntes por personas; pregunta por la DINÁMICA.
  · "¿Cómo de fácil o difícil es hoy hablar con el resto y ponerse de acuerdo?"
  · "¿Sería descabellado que cada uno quisiera una cosa distinta con el edificio?"
  · "¿Hay alguien que, en la práctica, acabe bloqueando cualquier decisión?"
  · "¿Me equivoco si imagino que usted no es el único que, a estas alturas, ya saldría si pudiera?"
Si se incomoda, etiquetas y te retiras: "Lo dejamos ahí, no quiero que sienta que le interrogo."

FASE 5 · CIERRE HACIA REUNIÓN. SIEMPRE pregunta orientada al "no":
  · "¿Sería mala idea que alguien de Afflux le pusiera números concretos a su situación, en
     privado y sin compromiso?"
  · "Si prefiere, le dejo la información por aquí y me dice usted cuándo. ¿Le va peor entre semana
     o el fin de semana?"
Si esquiva: etiqueta ("Parece que aún no es el momento, y es totalmente legítimo") y pasa a
seguimiento programado.

════════════════════════════════════════════════════════════════

EJEMPLOS DEL PLAYBOOK INTERNO (referencia, no copies literal):
${vossSnippets.join("\n") || "- (sin ejemplos cargados)"}

DATOS YA CONOCIDOS DEL LEAD (NO los vuelvas a preguntar): ${JSON.stringify(qual)}
${isResend ? "\nIMPORTANTE: el cliente ha REENVIADO un mensaje que ya os habíais cruzado antes. Retoma la conversación donde la dejasteis, NO saludes de nuevo ni repitas presentaciones.\n" : ""}
${priorContactsText}

DEVUELVES SIEMPRE un JSON con esta forma EXACTA y nada más:
{
  "categoria": "A" | "B" | "C" | "D" | "E" | "F",
  "messages": ["...", "..."],
  "needs_handoff": boolean,
  "handoff_reason"?: "operativo" | "comprador" | "fuera_madrid" | "otro",
  "qualification_update": {
    "nombre_apellidos"?: string,
    "fase_actual"?: 0|1|2|3|4|5,
    "estado_edificio"?: "alquilado" | "vacio" | "mixto",
    "renta_mensual_estimada"?: number,
    "gestion_rentas"?: "contacto" | "otro" | "nadie",
    "tipologia_proindivisario"?: "01" | "02" | "03" | "04" | "05" | "06" | "07",
    "cuota_participacion"?: number,
    "motivacion_principal"?: string,
    "urgencia"?: "alta" | "media" | "baja",
    "decide_solo"?: "si" | "no" | "explorando",
    "num_copropietarios"?: number,
    "dinamica_decision"?: "consenso" | "un_lider" | "bloqueo",
    "nivel_conflicto"?: "bajo" | "medio" | "alto",
    "cobertura_edificio"?: string,
    "interes_reunion"?: "si" | "agendar" | "seguimiento",
    "p0_complejidad"?: string,
    "p1_oferta_previa"?: "si" | "no",
    "p2_motivo"?: "liquidez" | "discrecion" | "herencia",
    "p3_sensible"?: string
  },
  "rol_inferido"?: {
    "rol_owner": "particular" | "heredero" | "inversor_pasivo" | "operador_profesional" | "institucional" | "desconocido",
    "subrol_owner"?: "ninguno" | "heredero_operador" | "heredero_residente" | "heredero_ausente" | "heredero_conflictivo" | "arrendador" | "usufructuario" | "nudo_propietario" | "apoderado",
    "confianza": number
  },
  "propose_meeting": boolean
}
En "qualification_update" SOLO incluyes campos que hayas podido deducir CON SEGURIDAD. Si no se
sabe, OMÍTELO. No inventes. NO sobrescribas un campo ya conocido salvo que el propietario lo
corrija explícitamente.

Para "cobertura_edificio" describe ALIADOS POTENCIALES SIN nombres
("hay otros 2 que también venderían" / "cree que su prima también daría el paso").

REGLA "rol_inferido" — clasifica al lead. SÓLO incluye este bloque si confianza ≥ 0.7:
- "particular": dueño individual que vive o usa el inmueble.
- "heredero": tiene el edificio por herencia. Sub:
    · "heredero_residente" → vive allí.
    · "heredero_operador" → lo gestiona él activamente.
    · "heredero_ausente"  → no vive ni gestiona (lo lleva otro familiar). [CASO TÍPICO]
    · "heredero_conflictivo" → hay disputas familiares.
- "inversor_pasivo": compró para alquilar y no se mete.
- "operador_profesional": gestor de patrimonio / dueño de varios edificios.
- "institucional": fondo, SOCIMI, sociedad grande.
- "desconocido": sin pistas suficientes.`;

    const aiMessages = [
      { role: "system", content: systemPrompt },
      ...realHistory.map((m: any) => ({
        role: m.direction === "in" ? "user" : "assistant",
        content: m.direction === "out" && m.sender_type === "human_agent"
          ? `[Mensaje escrito por ${agentNames[m.agent_user_id] ?? "un agente humano del equipo"}]: ${m.content}`
          : m.content,
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
      ? parsed.messages.filter((s: any) => typeof s === "string" && s.trim()).slice(0, 2)
      : [];
    if (replyMsgs.length === 0) {
      return new Response(JSON.stringify({ ok: true, skip: "empty reply" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Anti-duplicado: si el bot mandó literalmente lo mismo en los ÚLTIMOS 5 MINUTOS,
    // no repitas. Antes se miraban los últimos 6 OUT de toda la historia y eso silenciaba
    // al bot cuando un cliente reenviaba días después el mismo mensaje inicial.
    const DUP_WINDOW_MS = 5 * 60 * 1000;
    const nowMs = Date.now();
    const recentOuts = realHistory
      .filter((m: any) => m.direction === "out" && (nowMs - new Date(m.created_at).getTime()) < DUP_WINDOW_MS)
      .map((m: any) => normTxt(m.content));
    const filteredReply = replyMsgs.filter((m) => !recentOuts.includes(normTxt(m)));
    if (filteredReply.length === 0) {
      // Registrar nota interna para que el comercial vea que el bot se saltó la respuesta.
      await admin.from("wa_messages").insert({
        conversation_id,
        contact_id: contact.id,
        direction: "out",
        type: "system",
        content: "⚠️ Respuesta del bot omitida por anti-duplicado. Revisa y contesta manualmente si procede.",
        ai_generated: true,
        sender_type: "system",
        metadata: { kind: "dup_skip", model_reply: replyMsgs, last_in: lastInText },
      });
      // Bump unread_count manualmente para que el comercial vea el aviso en el inbox.
      const { data: convRow } = await admin.from("wa_conversations")
        .select("unread_count").eq("id", conversation_id).maybeSingle();
      await admin.from("wa_conversations").update({
        last_message_at: new Date().toISOString(),
        unread_count: ((convRow as any)?.unread_count ?? 0) + 1,
      }).eq("id", conversation_id);
      await admin.from("wa_ai_jobs").update({
        status: "skipped_dup",
        error: JSON.stringify({ reason: "duplicate_of_recent_reply", window_ms: DUP_WINDOW_MS, n_recent_outs: recentOuts.length }),
        updated_at: new Date().toISOString(),
      }).eq("conversation_id", conversation_id).eq("status", "pending");
      return new Response(JSON.stringify({ ok: true, skip: "duplicate of recent reply", logged: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const finalReplies = filteredReply;

    // Merge qualification (sin sobrescribir lo ya conocido, solo añadir nuevos).
    // Campos del guion Afflux (doc interno v2026-06).
    const qu = parsed.qualification_update ?? {};
    const allowedString = new Set([
      "nombre_apellidos", "motivacion_principal", "cobertura_edificio",
      "p0_complejidad", "p3_sensible",
    ]);
    const allowedEnum: Record<string, Set<string>> = {
      estado_edificio: new Set(["alquilado","vacio","mixto"]),
      gestion_rentas: new Set(["contacto","otro","nadie"]),
      tipologia_proindivisario: new Set(["01","02","03","04","05","06","07"]),
      urgencia: new Set(["alta","media","baja"]),
      decide_solo: new Set(["si","no","explorando"]),
      dinamica_decision: new Set(["consenso","un_lider","bloqueo"]),
      nivel_conflicto: new Set(["bajo","medio","alto"]),
      interes_reunion: new Set(["si","agendar","seguimiento"]),
      p1_oferta_previa: new Set(["si","no"]),
      p2_motivo: new Set(["liquidez","discrecion","herencia"]),
    };
    const allowedNumber = new Set([
      "fase_actual", "renta_mensual_estimada", "cuota_participacion", "num_copropietarios",
    ]);
    const cleanQu: Record<string, any> = {};
    for (const [k, v] of Object.entries(qu ?? {})) {
      if (v == null) continue;
      // fase_actual SÍ puede actualizarse (avanza la conversación).
      const isPhase = k === "fase_actual";
      const already = qual[k];
      if (!isPhase && already != null && already !== "") continue;
      if (allowedString.has(k) && typeof v === "string" && v.trim()) {
        cleanQu[k] = v.trim();
      } else if (allowedEnum[k] && typeof v === "string" && allowedEnum[k].has(v)) {
        cleanQu[k] = v;
      } else if (allowedNumber.has(k) && (typeof v === "number" || (typeof v === "string" && !isNaN(Number(v))))) {
        cleanQu[k] = Number(v);
      }
    }
    let newQual: Record<string, any> = { ...qual, ...cleanQu };

    // ────────────────────────────────────────────────────────────
    // CLASIFICADOR DE PUERTA: guardamos `categoria` en la conversación
    // y, si es C (operativo) o E (comprador), preparamos handoff humano
    // DESPUÉS de enviar la respuesta del bot.
    // ────────────────────────────────────────────────────────────
    const CATS = new Set(["A","B","C","D","E","F"]);
    const categoria: string | null = (typeof parsed.categoria === "string" && CATS.has(parsed.categoria))
      ? parsed.categoria : null;
    if (categoria) newQual.categoria = categoria;
    const HANDOFF_REASONS = new Set(["operativo","comprador","fuera_madrid","otro"]);
    let handoffReason: string | null = null;
    if (parsed.needs_handoff === true || categoria === "C" || categoria === "E") {
      const r = typeof parsed.handoff_reason === "string" && HANDOFF_REASONS.has(parsed.handoff_reason)
        ? parsed.handoff_reason
        : (categoria === "C" ? "operativo" : categoria === "E" ? "comprador" : "otro");
      handoffReason = r;
      newQual.handoff_reason = r;
    }

    // ────────────────────────────────────────────────────────────
    // Señales de OPORTUNIDAD (Proceso 4) — calculadas server-side.
    // ────────────────────────────────────────────────────────────
    const flags = new Set<string>(Array.isArray(newQual.oportunidad_flags) ? newQual.oportunidad_flags : []);
    const flagsBefore = new Set(flags);
    if (newQual.dinamica_decision === "bloqueo" && newQual.nivel_conflicto === "alto") flags.add("fragmentacion");
    if (newQual.decide_solo === "si" && ["02","03"].includes(String(newQual.tipologia_proindivisario))) flags.add("cuota_accionable");
    if (newQual.tipologia_proindivisario === "07" && typeof newQual.cobertura_edificio === "string" && newQual.cobertura_edificio.trim()) flags.add("compra_multiple");
    const motiv = String(newQual.motivacion_principal ?? "").toLowerCase();
    if (newQual.urgencia === "alta" && /salir|dignidad|liberar|carga|cierre|cerrar/.test(motiv)) flags.add("listo_para_mover");
    const newFlags = [...flags];
    const flagsChanged = newFlags.length !== flagsBefore.size || newFlags.some((f) => !flagsBefore.has(f));
    if (flagsChanged) newQual.oportunidad_flags = newFlags;

    if (Object.keys(cleanQu).length > 0 || flagsChanged || categoria || handoffReason) {
      await admin.from("wa_conversations").update({ qualification: newQual }).eq("id", conversation_id);
    }

    // Rol/subrol inferido por la IA. Sólo lo escribimos si:
    //  - hay confianza ≥ 0.7
    //  - el comercial NO ha fijado uno manualmente (rol_source !== 'manual')
    try {
      const ROLES = new Set(["particular","heredero","inversor_pasivo","operador_profesional","institucional","desconocido"]);
      const SUBROLES = new Set(["ninguno","heredero_operador","heredero_residente","heredero_ausente","heredero_conflictivo","arrendador","usufructuario","nudo_propietario","apoderado"]);
      const ri = parsed.rol_inferido;
      const isManual = (conv as any).rol_source === "manual";
      if (!isManual && ri && typeof ri === "object" && ROLES.has(ri.rol_owner) && Number(ri.confianza ?? 0) >= 0.7) {
        const patch: any = {
          rol_owner: ri.rol_owner,
          rol_source: "ia",
          rol_confianza: Number(ri.confianza),
        };
        if (ri.subrol_owner && SUBROLES.has(ri.subrol_owner)) patch.subrol_owner = ri.subrol_owner;
        await admin.from("wa_conversations").update(patch).eq("id", conversation_id);
      }
    } catch (_e) { /* no bloquear el reply por esto */ }

    // 4) TIEMPOS HUMANOS: delay total + presence typing + 1-3 mensajes con micro pausas
    // Si la conversación está activa (último saliente del bot < 5 min), respondemos rápido.
    // Si es primer contacto / lleva tiempo fría, mantenemos el delay humano largo.
    const lastOut = [...realHistory].reverse().find((m: any) => m.direction === "out");
    const lastOutAgeMs = lastOut?.created_at ? (Date.now() - new Date(lastOut.created_at).getTime()) : Infinity;
    const isActive = lastOutAgeMs < 5 * 60 * 1000;
    const minS = isActive
      ? ((cfg as any)?.reply_delay_active_min ?? 3)
      : ((cfg as any)?.reply_delay_min ?? 8);
    const maxS = isActive
      ? ((cfg as any)?.reply_delay_active_max ?? 10)
      : ((cfg as any)?.reply_delay_max ?? 45);
    const totalMs = Math.floor((minS + Math.random() * Math.max(1, maxS - minS)) * 1000);
    const perMsg = Math.floor(totalMs / Math.max(1, finalReplies.length));

    for (let i = 0; i < finalReplies.length; i++) {
      const m = finalReplies[i];
      const typingMs = isActive
        ? Math.max(800, Math.min(perMsg - 400, 6000))
        : Math.max(1500, Math.min(perMsg - 600, 12000));
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
        sender_type: "bot",
        metadata: {
          model: "google/gemini-3-flash-preview",
          part: i + 1, of: finalReplies.length,
          qualification_update: cleanQu,
          propose_meeting: !!parsed.propose_meeting,
        },
      });
      if (i < finalReplies.length - 1) {
        await sleep(isActive
          ? 300 + Math.floor(Math.random() * 600)
          : 700 + Math.floor(Math.random() * 1600));
      }
    }

    await admin.from("wa_conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conversation_id);
    await admin.from("wa_ai_jobs").update({ status: "done", updated_at: new Date().toISOString() })
      .eq("conversation_id", conversation_id).eq("status", "pending");

    // Auto-avance de stage suave (guion Afflux).
    const currentStage = contact.stage ?? "nuevo";
    let nextStage: string | null = null;
    if (currentStage === "nuevo") nextStage = "conversando";
    // Cualificado: tipología detectada + al menos 3 datos de Fase 1-2.
    const fase12 = ["estado_edificio","renta_mensual_estimada","gestion_rentas","cuota_participacion"]
      .filter((k) => newQual[k] != null && newQual[k] !== "").length;
    if (newQual.tipologia_proindivisario && fase12 >= 3 &&
        !["cualificado","caliente","handoff"].includes(currentStage)) {
      nextStage = "cualificado";
    }
    // Caliente: cualquier flag de oportunidad o interes_reunion='si'.
    if ((newFlags.length > 0 || newQual.interes_reunion === "si") &&
        currentStage !== "caliente" && currentStage !== "handoff") {
      nextStage = "caliente";
    }
    if (nextStage && nextStage !== currentStage) {
      await admin.from("wa_contacts").update({ stage: nextStage }).eq("id", contact.id);
    }

    // Si el clasificador marcó handoff (C operativo / E comprador), pausamos el bot
    // DESPUÉS de enviar la respuesta del modelo, para que un humano retome.
    if (handoffReason) {
      await admin.from("wa_contacts").update({ stage: "handoff" }).eq("id", contact.id);
    }

    // Resumen: forzar si propuesta de reunión, nueva flag de oportunidad, o cambio de stage.
    const forceSummary = !!parsed.propose_meeting || flagsChanged || (nextStage === "caliente");
    fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa_summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
      body: JSON.stringify({ conversation_id, force: forceSummary }),
    }).catch(() => {});

    // Sync HubSpot bajo las mismas condiciones (resumen forzado, nueva flag o caliente).
    if (forceSummary) {
      fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/wa_sync_hubspot`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ conversation_id }),
      }).catch(() => {});
    }

    return new Response(JSON.stringify({
      ok: true, sent: finalReplies.length, qualification_update: cleanQu, propose_meeting: !!parsed.propose_meeting,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});