// Recibe eventos del Evolution API. Público (verify_jwt=false).
import { createClient } from "npm:@supabase/supabase-js@2";
import { normalizePhone } from "../_shared/evolution.ts";

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
        ?? msg?.body
        ?? msg?.text
        ?? "";
      const evoId: string = msg?.key?.id ?? msg?.id ?? crypto.randomUUID();
      const pushName: string | null = msg?.pushName ?? null;
      const phone = normalizePhone(remoteJid.split("@")[0]);

      // contact
      const { data: contact } = await admin.from("wa_contacts")
        .upsert({ phone, jid: remoteJid, name: pushName ?? undefined, last_message_at: new Date().toISOString() }, { onConflict: "phone" })
        .select("id, stage").single();

      // conversation (latest open)
      let convId: string | null = null;
      const { data: existingConv } = await admin.from("wa_conversations").select("id, ai_enabled")
        .eq("contact_id", contact!.id).eq("status", "open").order("created_at", { ascending: false }).limit(1).maybeSingle();
      let aiEnabled = true;
      if (existingConv) { convId = existingConv.id; aiEnabled = (existingConv as any).ai_enabled ?? true; }
      else {
        const { data: newConv } = await admin.from("wa_conversations")
          .insert({ contact_id: contact!.id, status: "open" }).select("id, ai_enabled").single();
        convId = newConv!.id; aiEnabled = (newConv as any).ai_enabled ?? true;
      }

      // message
      const msgType = mediaKind ?? "text";
      const initialContent = mediaKind
        ? (mediaCaption || "")
        : text;
      const mediaMeta = mediaKind ? {
        media: {
          kind: mediaKind,
          mimetype: mediaMimetype,
          filename: mediaFilename,
          caption: mediaCaption || null,
          processing: fromMe ? "skipped" : "pending",
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

      // Solo respondemos a entrantes y solo si el bot está activo y no estamos en handoff.
      const stage = (contact as any)?.stage;
      if (!fromMe && aiEnabled && stage !== "handoff") {
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