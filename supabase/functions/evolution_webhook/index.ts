// Recibe eventos del Evolution API. Público (verify_jwt=false).
import { createClient } from "npm:@supabase/supabase-js@2";
import { normalizePhone, evoFetch, EVOLUTION_INSTANCE } from "../_shared/evolution.ts";

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

    const payload = await req.json().catch(() => ({} as any));
    const event: string = String(payload?.event ?? "").toLowerCase();
    const instance: string = payload?.instance ?? payload?.instanceName ?? Deno.env.get("EVOLUTION_INSTANCE_NAME") ?? "afflux";
    const data = payload?.data ?? payload;

    if (event.includes("qrcode") || event === "qrcode.updated") {
      const raw = data?.qrcode?.base64 ?? data?.base64 ?? data?.qr ?? null;
      const qr = raw ? (String(raw).startsWith("data:") ? raw : `data:image/png;base64,${raw}`) : null;
      await admin.from("wa_instances").upsert({
        instance_name: instance, status: "qr", qr_base64: qr, last_seen_at: new Date().toISOString(),
      }, { onConflict: "instance_name" });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (event.includes("connection") || event === "connection.update") {
      const state = data?.state ?? data?.connection ?? null;
      let status = "disconnected";
      if (state === "open") status = "connected";
      else if (state === "connecting") status = "connecting";
      await admin.from("wa_instances").upsert({
        instance_name: instance, status,
        qr_base64: status === "connected" ? null : undefined as any,
        last_seen_at: new Date().toISOString(),
      }, { onConflict: "instance_name" });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (event.includes("messages.upsert") || event === "messages.upsert") {
      const msg = Array.isArray(data?.messages) ? data.messages[0] : data;
      if (!msg) return new Response(JSON.stringify({ ok: true, skip: "no msg" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const remoteJid: string = msg?.key?.remoteJid ?? msg?.remoteJid ?? "";
      if (!remoteJid || remoteJid.endsWith("@g.us")) {
        return new Response(JSON.stringify({ ok: true, skip: "group" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const fromMe: boolean = !!(msg?.key?.fromMe ?? msg?.fromMe);
      const m = msg?.message ?? {};
      const audioMsg = m.audioMessage ?? m.pttMessage ?? null;
      const imageMsg = m.imageMessage ?? null;
      const docMsg = m.documentMessage ?? m.documentWithCaptionMessage?.message?.documentMessage ?? null;
      const videoMsg = m.videoMessage ?? null;

      let mediaKind: "audio" | "image" | "document" | "video" | null = null;
      let mediaCaption = "";
      let mediaMimetype: string | null = null;
      let mediaFilename: string | null = null;
      if (audioMsg) { mediaKind = "audio"; mediaMimetype = audioMsg.mimetype ?? null; }
      else if (imageMsg) { mediaKind = "image"; mediaCaption = imageMsg.caption ?? ""; mediaMimetype = imageMsg.mimetype ?? null; }
      else if (docMsg) { mediaKind = "document"; mediaCaption = docMsg.caption ?? ""; mediaMimetype = docMsg.mimetype ?? null; mediaFilename = docMsg.fileName ?? docMsg.title ?? null; }
      else if (videoMsg) { mediaKind = "video"; mediaCaption = videoMsg.caption ?? ""; mediaMimetype = videoMsg.mimetype ?? null; }

      const text: string = m.conversation
        ?? m.extendedTextMessage?.text
        ?? m.ephemeralMessage?.message?.conversation
        ?? m.ephemeralMessage?.message?.extendedTextMessage?.text
        ?? m.viewOnceMessageV2?.message?.conversation
        ?? m.viewOnceMessageV2?.message?.extendedTextMessage?.text
        ?? m.buttonsResponseMessage?.selectedDisplayText
        ?? m.templateButtonReplyMessage?.selectedDisplayText
        ?? msg?.body
        ?? msg?.text
        ?? "";
      const evoId: string = msg?.key?.id ?? msg?.id ?? crypto.randomUUID();
      const pushName: string | null = msg?.pushName ?? null;
      const phone = normalizePhone(remoteJid.split("@")[0]);

      // ── Comando oculto /reset ─────────────────────────────────────────
      // Si el cliente escribe "/reset" (o sinónimos) cerramos la conversación
      // abierta y arrancamos una nueva. No invocamos al bot para este turno.
      const normalizedText = typeof text === "string"
        ? text.replace(/[\u200b\u200e\u200f\ufeff]/g, "").trim().toLowerCase()
        : "";
      const RESET_TOKENS = new Set(["/reset", "reset", "/start", "/reiniciar", "reiniciar"]);
      const isResetCommand = !fromMe && !mediaKind && RESET_TOKENS.has(normalizedText);
      if (isResetCommand) {
        console.log("[reset] detected", { phone, raw: text, normalized: normalizedText });
        const { data: contactR } = await admin.from("wa_contacts")
          .upsert({ phone, jid: remoteJid, name: pushName ?? undefined, last_message_at: new Date().toISOString() }, { onConflict: "phone" })
          .select("id, metadata").single();

        // Cerrar todas las conversaciones abiertas de este contacto
        const { data: openConvs } = await admin.from("wa_conversations")
          .select("id, metadata").eq("contact_id", contactR!.id).eq("status", "open");
        for (const c of (openConvs ?? [])) {
          await admin.from("wa_conversations").update({
            status: "closed",
            metadata: { ...((c as any).metadata ?? {}), closed_reason: "reset_by_user", closed_at: new Date().toISOString() },
          }).eq("id", (c as any).id);
        }

        // Reset de stage y limpieza de cualificación en el contacto
        const mdR: any = (contactR as any)?.metadata ?? {};
        await admin.from("wa_contacts").update({
          stage: "nuevo",
          metadata: { ...mdR, qualification: {}, reset_at: new Date().toISOString() },
        }).eq("id", (contactR as any).id);

        // Crear conversación nueva limpia
        const { data: newConv } = await admin.from("wa_conversations")
          .insert({ contact_id: (contactR as any).id, status: "open", metadata: { opened_reason: "reset_by_user" } })
          .select("id").single();

        // Registrar el mensaje /reset del cliente en la nueva conversación (auditoría)
        await admin.from("wa_messages").insert({
          conversation_id: (newConv as any).id,
          contact_id: (contactR as any).id,
          direction: "in",
          type: "text",
          content: text,
          evolution_message_id: evoId,
          ai_generated: false,
          metadata: { raw: msg, command: "reset" },
        });

        // Confirmación al cliente
        const confirmText = "Conversación reseteada, ya puedes comenzar de nuevo una conversación";
        let ackError: string | null = null;
        try {
          const sendRes = await evoFetch(`/message/sendText/${EVOLUTION_INSTANCE}`, {
            method: "POST",
            body: JSON.stringify({ number: phone, text: confirmText }),
          });
          console.log("[reset] ack sent", { msgId: sendRes?.key?.id ?? null, phone });
          await admin.from("wa_messages").insert({
            conversation_id: (newConv as any).id,
            contact_id: (contactR as any).id,
            direction: "out",
            type: "text",
            content: confirmText,
            evolution_message_id: sendRes?.key?.id ?? null,
            ai_generated: false,
            sender_type: "system",
            metadata: { command: "reset_ack" },
          });
        } catch (e) {
          ackError = (e as any)?.message ?? String(e);
          console.error("[reset] ack FAILED", { phone, err: ackError });
        }

        await admin.from("wa_conversations").update({
          last_message_at: new Date().toISOString(),
          unread_count: 0,
        }).eq("id", (newConv as any).id);

        return new Response(JSON.stringify({ ok: !ackError, reset: true, ack_error: ackError }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // contact
      const { data: contact } = await admin.from("wa_contacts")
        .upsert({ phone, jid: remoteJid, name: pushName ?? undefined, last_message_at: new Date().toISOString() }, { onConflict: "phone" })
        .select("id, stage, lead_id, metadata").single();

      // Identificación contra owners de la BD (idempotente)
      try {
        const md: any = (contact as any)?.metadata ?? {};
        const lastMatch = md?.matched_at ? Date.parse(md.matched_at) : 0;
        const stale = !lastMatch || (Date.now() - lastMatch) > 7 * 24 * 3600 * 1000;
        if (!(contact as any)?.lead_id && stale) {
          const { data: matches } = await admin.rpc("match_owner_by_phone", { p_phone: phone });
          const m = Array.isArray(matches) ? matches[0] : matches;
          const newMeta = {
            ...md,
            match_status: m?.match_status ?? "none",
            matched_at: new Date().toISOString(),
            matched_owner_nombre: m?.owner_nombre ?? null,
            matched_buildings: m?.buildings ?? [],
          };
          await admin.from("wa_contacts").update({
            lead_id: m?.owner_id ?? null,
            metadata: newMeta,
          }).eq("id", (contact as any).id);
        }
      } catch (e) {
        console.warn("[evolution_webhook] match_owner_by_phone failed", (e as any)?.message);
      }

      // conversation (latest open)
      let convId: string | null = null;
      const { data: existingConv } = await admin.from("wa_conversations").select("id, ai_enabled")
        .eq("contact_id", contact!.id).eq("status", "open").order("created_at", { ascending: false }).limit(1).maybeSingle();
      let aiEnabled = true;
      let convJustCreated = false;
      if (existingConv) { convId = existingConv.id; aiEnabled = (existingConv as any).ai_enabled ?? true; }
      else {
        const { data: newConv } = await admin.from("wa_conversations")
          .insert({ contact_id: contact!.id, status: "open" }).select("id, ai_enabled").single();
        convId = newConv!.id; aiEnabled = (newConv as any).ai_enabled ?? true;
        convJustCreated = true;
      }

      // message
      const isVideo = mediaKind === "video";
      const VIDEO_PLACEHOLDER = "🎥 Vídeo recibido (no visible por el asistente)";
      const msgType = mediaKind ?? "text";
      const initialContent = mediaKind
        ? (isVideo
            ? (mediaCaption ? `${VIDEO_PLACEHOLDER}. Texto adjunto: ${mediaCaption}` : VIDEO_PLACEHOLDER)
            : (mediaCaption || ""))
        : text;
      const mediaMeta = mediaKind ? {
        media: {
          kind: mediaKind,
          mimetype: mediaMimetype,
          filename: mediaFilename,
          caption: mediaCaption || null,
          // El vídeo no se procesa (no lo ve el asistente): lo marcamos "skipped"
          // para que wa_ai_reply responda directamente en vez de esperar el procesado.
          processing: fromMe ? "skipped" : (isVideo ? "skipped" : "pending"),
        },
      } : {};
      const { data: insertedMsg } = await admin.from("wa_messages").insert({
        conversation_id: convId,
        contact_id: contact!.id,
        direction: fromMe ? "out" : "in",
        type: msgType,
        content: initialContent,
        evolution_message_id: evoId,
        ai_generated: false,
        metadata: { raw: msg, ...mediaMeta },
      }).select("id").single();

      await admin.from("wa_conversations").update({
        last_message_at: new Date().toISOString(),
        unread_count: fromMe ? 0 : ((existingConv as any)?.unread_count ?? 0) + 1,
      }).eq("id", convId!);

      // ── Notificación email al iniciar una NUEVA conversación (primer mensaje entrante
      // de un lead sin histórico). Programa también resumen a +15 min.
      if (convJustCreated && !fromMe) {
        try {
          const { count: priorCount } = await admin.from("wa_messages")
            .select("id", { count: "exact", head: true })
            .eq("contact_id", contact!.id)
            .neq("id", insertedMsg?.id ?? "00000000-0000-0000-0000-000000000000");
          const isFirstEver = (priorCount ?? 0) === 0;
          if (isFirstEver) {
            const nowIso = new Date().toISOString();
            const in15 = new Date(Date.now() + 15 * 60 * 1000).toISOString();
            // Filas idempotentes (unique(conversation_id, kind))
            await admin.from("pending_conversation_emails").upsert([
              { conversation_id: convId!, contact_id: contact!.id, phone, kind: "conv_started", send_at: nowIso, status: "pending" },
              { conversation_id: convId!, contact_id: contact!.id, phone, kind: "summary_15m", send_at: in15, status: "pending" },
            ], { onConflict: "conversation_id,kind" });
            // Dispara el dispatcher inmediatamente para el conv_started (best-effort)
            fetch(`${SUPABASE_URL}/functions/v1/wa_conversation_email_dispatcher`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
              body: "{}",
            }).catch(() => {});
          }
        } catch (e) {
          console.warn("[evolution_webhook] pending_conversation_emails schedule failed", (e as any)?.message);
        }
      }

      // KILL SWITCH GLOBAL: si is_active=false seguimos REGISTRANDO el entrante (arriba),
      // pero NO disparamos auto-respuesta ni procesado de media. La ingesta no se pierde.
      const { data: killCfg } = await admin.from("wa_bot_config").select("is_active").limit(1).maybeSingle();
      const botActive = (killCfg as any)?.is_active !== false;

      // Solo respondemos a entrantes y solo si el bot está activo y no estamos en handoff.
      const stage = (contact as any)?.stage;
      if (!fromMe && aiEnabled && stage !== "handoff" && botActive) {
        await admin.from("wa_ai_jobs").insert({
          conversation_id: convId,
          run_after: new Date().toISOString(),
        });
        if (mediaKind && mediaKind !== "video") {
          // Procesar el media primero; al terminar, esa función dispara wa_ai_reply.
          fetch(`${SUPABASE_URL}/functions/v1/wa_process_incoming_media`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
            body: JSON.stringify({ message_id: insertedMsg?.id, conversation_id: convId }),
          }).catch(() => {});
        } else {
          fetch(`${SUPABASE_URL}/functions/v1/wa_ai_reply`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
            body: JSON.stringify({ conversation_id: convId }),
          }).catch(() => {});
        }
      }

      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ ok: true, ignored: event }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});