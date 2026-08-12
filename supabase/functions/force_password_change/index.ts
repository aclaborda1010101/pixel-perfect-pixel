// =====================================================================
// force_password_change — NO DESPLEGADA (fase B, pendiente de activar)
// =====================================================================
// Cambia la contraseña del usuario AUTENTICADO y, sólo después, baja el
// flag profiles.must_change_password con service role.
//
// Garantías:
//  - Sólo actúa sobre el usuario del JWT presentado. No admite user_id externo.
//  - NUNCA registra la contraseña ni los tokens.
//  - Si Auth falla, no se toca el perfil.
//  - Si Auth va bien pero la base falla, se informa de estado PARCIAL y el
//    acceso sigue bloqueado (el flag permanece a true).
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import { clearMustChangePassword, PARTIAL_MESSAGE } from "./profile.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MIN_LEN = 10;

/**
 * Flag de fase B (espejo de src/lib/featureFlags.ts). Activa: la función
 * opera. Si se apaga, falla CERRADA antes de tocar Auth.
 */
const FEATURE_FORCE_PASSWORD_EDGE_FN = true;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "método no permitido" }, 405);
  if (!FEATURE_FORCE_PASSWORD_EDGE_FN) {
    return json({ ok: false, stage: "disabled", error: "función no habilitada" }, 503);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "no autenticado" }, 401);

  let password = "";
  try {
    const body = await req.json();
    password = typeof body?.password === "string" ? body.password : "";
  } catch {
    return json({ error: "cuerpo inválido" }, 400);
  }
  if (password.length < MIN_LEN) {
    return json({ error: `la contraseña debe tener al menos ${MIN_LEN} caracteres` }, 400);
  }

  // Cliente ligado al JWT del propio usuario: la identidad la pone el token.
  const userClient = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "sesión inválida" }, 401);
  const userId = userData.user.id;

  const { error: pwErr } = await userClient.auth.updateUser({ password });
  if (pwErr) {
    // No se registra ni la contraseña ni el token, sólo el código de error.
    console.error("auth_update_failed", pwErr.status ?? "unknown");
    const raw = (pwErr.message ?? "").toLowerCase();
    let msg = "No se pudo actualizar la contraseña.";
    if (raw.includes("different from the old")) {
      msg = "La nueva contraseña debe ser distinta de la actual.";
    } else if (raw.includes("weak") || raw.includes("password should")) {
      msg = "La contraseña es demasiado débil. Usa mayúsculas, minúsculas y números.";
    } else if (raw.includes("same") || raw.includes("reuse")) {
      msg = "La nueva contraseña debe ser distinta de la actual.";
    }
    // 200 con ok:false: el cliente necesita leer el motivo real (invoke oculta
    // el cuerpo en respuestas no-2xx).
    return json({ ok: false, stage: "auth", error: msg }, 200);
  }

  // Sólo tras el éxito en Auth se baja el flag, con service role.
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const res = await clearMustChangePassword(admin as any, userId);
  if (res.ok) return json({ ok: true, stage: "done", must_change_password: false });

  return json(
    {
      ok: false,
      stage: "partial",
      reason: res.reason,
      must_change_password: true,
      error: PARTIAL_MESSAGE,
    },
    207,
  );
});
