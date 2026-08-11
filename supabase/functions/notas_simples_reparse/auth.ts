// AUTORIZACIÓN DEL ENDPOINT (P0.8).
//
// verify_jwt=false en la plataforma NO significa endpoint abierto: la función
// valida la credencial EN CÓDIGO. Se admite:
//   a) secreto interno REPARSE_INTERNAL_SECRET (cabecera x-internal-secret o
//      Authorization: Bearer <secreto>), comparado en tiempo constante;
//   b) JWT verificable cuyo claim de rol sea service_role o admin.
// Sin credencial => 401. Credencial válida sin rol autorizado => 403.
// Sin secreto configurado y sin verificador => 503 (fail-closed, jamás abierto).
//
// Ningún token, secreto ni fragmento de ellos aparece en respuestas ni logs.

export type Principal = "service" | "admin";

export type AuthOk = { ok: true; principal: Principal; via: "internal_secret" | "jwt" };
export type AuthFail = { ok: false; status: 401 | 403 | 503; reason: string };
export type AuthDecision = AuthOk | AuthFail;

export type JwtVerifier = (token: string) => Promise<{ ok: boolean; role?: string | null; reason?: string } > | { ok: boolean; role?: string | null; reason?: string };

/** Comparación en tiempo constante (evita oráculos por temporización). */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = String(a ?? "");
  const y = String(b ?? "");
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0 && x.length > 0;
}

const ROLES_AUTORIZADOS: Record<string, Principal> = {
  service_role: "service",
  service: "service",
  admin: "admin",
};

/** Elimina cualquier credencial de un texto antes de loguearlo o devolverlo. */
export function redactar(texto: unknown): string {
  return String(texto ?? "")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9._-]{10,}/g, "[REDACTED_JWT]")
    .replace(/(secret|token|apikey|api_key|password)("?\s*[:=]\s*"?)[^\s",}]+/gi, "$1$2[REDACTED]");
}

function header(h: Headers | Record<string, string | null | undefined>, name: string): string {
  if (typeof (h as Headers)?.get === "function") return String((h as Headers).get(name) ?? "");
  const rec = h as Record<string, string | null | undefined>;
  const k = Object.keys(rec).find((x) => x.toLowerCase() === name.toLowerCase());
  return String((k ? rec[k] : "") ?? "");
}

export async function decidirAuth(args: {
  headers: Headers | Record<string, string | null | undefined>;
  internalSecret?: string | null;
  serviceRoleKey?: string | null;
  verifyJwt?: JwtVerifier | null;
}): Promise<AuthDecision> {
  const secreto = String(args.internalSecret ?? "").trim();
  const serviceKey = String(args.serviceRoleKey ?? "").trim();
  const bearer = header(args.headers, "authorization").replace(/^Bearer\s+/i, "").trim();
  const interno = header(args.headers, "x-internal-secret").trim();

  if (!secreto && !serviceKey && !args.verifyJwt) {
    return { ok: false, status: 503, reason: "auth_no_configurada" };
  }
  if (!bearer && !interno) {
    return { ok: false, status: 401, reason: "credencial_ausente" };
  }
  if (secreto && (timingSafeEqual(interno, secreto) || timingSafeEqual(bearer, secreto))) {
    return { ok: true, principal: "service", via: "internal_secret" };
  }
  if (serviceKey && timingSafeEqual(bearer, serviceKey)) {
    return { ok: true, principal: "service", via: "internal_secret" };
  }
  if (args.verifyJwt && bearer) {
    let v: { ok: boolean; role?: string | null; reason?: string };
    try {
      v = await args.verifyJwt(bearer);
    } catch (e) {
      return { ok: false, status: 401, reason: `jwt_error:${redactar((e as Error)?.message).slice(0, 80)}` };
    }
    if (!v?.ok) return { ok: false, status: 401, reason: `jwt_invalido:${redactar(v?.reason ?? "").slice(0, 80)}` };
    const principal = ROLES_AUTORIZADOS[String(v.role ?? "").toLowerCase()];
    if (!principal) return { ok: false, status: 403, reason: `rol_no_autorizado:${String(v.role ?? "sin_rol").slice(0, 40)}` };
    return { ok: true, principal, via: "jwt" };
  }
  return { ok: false, status: 401, reason: "credencial_invalida" };
}
