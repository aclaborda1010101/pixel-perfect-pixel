// Envío de emails vía Resend (o el servicio configurado). Sin dependencias.
// Requiere secreto RESEND_API_KEY. Remitente configurable con RESEND_FROM.
export async function sendEmail(opts: {
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

export function escapeHtml(s: string): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c] as string));
}