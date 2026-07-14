// Envío de emails. Prioriza Gmail SMTP (denomailer) si hay GMAIL_USER/GMAIL_APP_PASSWORD.
// Fallback a Resend si están configurados RESEND_API_KEY.
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

async function sendViaGmail(opts: {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const user = Deno.env.get("GMAIL_USER");
  const pass = (Deno.env.get("GMAIL_APP_PASSWORD") || "").replace(/\s+/g, "");
  if (!user || !pass) return { ok: false, error: "no_gmail_creds" };
  const port = Number(Deno.env.get("GMAIL_SMTP_PORT") || "465");
  const useTLS = port === 465;
  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port,
      tls: useTLS,
      auth: { username: user, password: pass },
    },
  });
  try {
    const to = Array.isArray(opts.to) ? opts.to : [opts.to];
    await client.send({
      from: user,
      to,
      subject: opts.subject,
      content: opts.text ?? "",
      html: opts.html,
      replyTo: opts.reply_to,
    });
    return { ok: true };
  } catch (e: any) {
    console.error("[mailer/gmail] send fail", e?.message ?? e);
    return { ok: false, error: `gmail_smtp: ${String(e?.message ?? e).slice(0, 300)}` };
  } finally {
    try { await client.close(); } catch { /* ignore */ }
  }
}

async function sendViaResend(opts: {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) {
    console.warn("[mailer] RESEND_API_KEY not set; skipping send");
    return { ok: false, error: "no_api_key" };
  }
  const from = Deno.env.get("RESEND_FROM") || "Afflux Bot <onboarding@resend.dev>";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: Array.isArray(opts.to) ? opts.to : [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        reply_to: opts.reply_to,
      }),
    });
    const body = await r.text();
    if (!r.ok) {
      console.error("[mailer] resend fail", r.status, body.slice(0, 400));
      return { ok: false, error: `${r.status}: ${body.slice(0, 300)}` };
    }
    let id: string | undefined;
    try { id = JSON.parse(body)?.id; } catch { /* ignore */ }
    return { ok: true, id };
  } catch (e: any) {
    console.error("[mailer] exception", e?.message ?? e);
    return { ok: false, error: String(e?.message ?? e) };
  }
}

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  // 1) Gmail SMTP primero
  if (Deno.env.get("GMAIL_USER") && Deno.env.get("GMAIL_APP_PASSWORD")) {
    const r = await sendViaGmail(opts);
    if (r.ok) return r;
    console.warn("[mailer] Gmail SMTP fail, trying Resend fallback:", r.error);
    // fallback
    const rr = await sendViaResend(opts);
    if (rr.ok) return rr;
    return { ok: false, error: `gmail=${r.error}; resend=${rr.error}` };
  }
  // 2) Resend fallback
  return await sendViaResend(opts);
}

export function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] as string));
}