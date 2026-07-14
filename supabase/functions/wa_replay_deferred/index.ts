// Retoma jobs 'deferred' (mensajes recibidos fuera de horario) en cuanto se abre
// la ventana activa (L-V 09:00-20:30 Europe/Madrid). Dispara wa_ai_reply una vez
// por conversación con jobs deferred. Se ejecuta desde pg_cron cada 5 minutos
// entre 06:00 y 10:00 UTC L-V (cubre CET y CEST); la guarda diaria en
// app_settings garantiza que sólo se lance UNA vez por día.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function madridNow(): { h: number; m: number; ymd: string; dow: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit",
    year: "numeric", month: "2-digit", day: "2-digit", hour12: false, weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    h: Number(parts.hour), m: Number(parts.minute),
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    dow: DOW[parts.weekday] ?? 1,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1) Kill switch global
    const { data: cfg } = await admin.from("wa_bot_config").select("*").limit(1).maybeSingle();
    if (!cfg || (cfg as any).is_active === false) {
      return new Response(JSON.stringify({ ok: true, skip: "kill_switch" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) Comprobar horario Madrid
    const ah = (cfg as any).active_hours ?? {};
    const activeDays: number[] = Array.isArray(ah.days) && ah.days.length
      ? ah.days.map((d: any) => Number(d)) : [1, 2, 3, 4, 5];
    const [fH, fM] = String(ah.from || "09:00").split(":").map((x: string) => Number(x));
    const [tH, tM] = String(ah.to || "20:30").split(":").map((x: string) => Number(x));
    const { h: nowH, m: nowM, dow, ymd } = madridNow();
    const nowMin = nowH * 60 + nowM;
    const openMin = (Number.isFinite(fH) ? fH : 9) * 60 + (Number.isFinite(fM) ? fM : 0);
    const closeMin = (Number.isFinite(tH) ? tH : 20) * 60 + (Number.isFinite(tM) ? tM : 30);
    const isWorkday = activeDays.includes(dow);
    const inHours = isWorkday && nowMin >= openMin && nowMin < closeMin;
    if (!inHours) {
      return new Response(JSON.stringify({ ok: true, skip: "off_hours", madrid: `${ymd} ${nowH}:${String(nowM).padStart(2,"0")}` }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3) Guarda anti-doble ejecución diaria (fecha Europe/Madrid)
    const { data: mark } = await admin.from("app_settings")
      .select("value").eq("key", "wa_replay_deferred_last").maybeSingle();
    const lastDate = (mark as any)?.value?.date ?? null;
    if (lastDate === ymd) {
      return new Response(JSON.stringify({ ok: true, skip: "already_ran_today", ymd }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Marca ANTES de disparar (idempotencia frente a solapes de cron)
    await admin.from("app_settings").upsert({
      key: "wa_replay_deferred_last",
      value: { date: ymd, at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    // 4) Conversaciones con jobs deferred
    const { data: jobs, error: jobsErr } = await admin
      .from("wa_ai_jobs")
      .select("conversation_id")
      .eq("status", "deferred");
    if (jobsErr) throw jobsErr;
    const convIds = Array.from(new Set(((jobs ?? []) as any[]).map((j) => j.conversation_id).filter(Boolean)));

    console.log(`[wa_replay_deferred] ymd=${ymd} inHours=true conversaciones_deferred=${convIds.length}`);

    if (convIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, conversations_relanzadas: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5) Para cada conversación: deferred → pending y disparar wa_ai_reply
    const replyUrl = `${SUPABASE_URL}/functions/v1/wa_ai_reply`;
    let launched = 0;
    for (const conversation_id of convIds) {
      await admin.from("wa_ai_jobs")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .eq("conversation_id", conversation_id)
        .eq("status", "deferred");

      // fire-and-forget; wa_ai_reply ya tiene mutex/debounce
      fetch(replyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SERVICE_KEY}`,
          "apikey": SERVICE_KEY,
        },
        body: JSON.stringify({ conversation_id }),
      }).catch((e) => console.error(`[wa_replay_deferred] fetch error ${conversation_id}:`, (e as Error)?.message ?? e));

      launched++;
      // pequeño jitter para no saturar Evolution
      await sleep(200 + Math.floor(Math.random() * 200));
    }

    return new Response(JSON.stringify({ ok: true, conversations_relanzadas: launched, ymd }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[wa_replay_deferred] error", e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});