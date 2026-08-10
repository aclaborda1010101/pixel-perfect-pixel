/**
 * Bajada del flag must_change_password — núcleo puro y testeable.
 *
 * Regla dura: la actualización debe afectar EXACTAMENTE a una fila.
 *  - 1 fila  -> hecho
 *  - 0 filas -> estado PARCIAL (perfil inexistente): no se reintenta
 *  - >1 fila -> estado PARCIAL (dato incoherente): no se reintenta
 *  - error   -> se reintenta; nunca se expone el mensaje interno
 */
export type ProfileUpdateResult =
  | { ok: true; stage: "done" }
  | { ok: false; stage: "partial"; reason: "sin_fila" | "multiples_filas" | "error" };

export type MinimalAdminClient = {
  from: (table: string) => {
    update: (patch: Record<string, unknown>) => {
      eq: (column: string, value: string) => {
        select: (columns: string) => Promise<{ data: unknown[] | null; error: { code?: string } | null }>;
      };
    };
  };
};

export async function clearMustChangePassword(
  admin: MinimalAdminClient,
  userId: string,
  opts: { retries?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ProfileUpdateResult> {
  const retries = opts.retries ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  for (let attempt = 1; attempt <= retries; attempt++) {
    const { data, error } = await admin
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", userId)
      .select("id");

    if (!error && Array.isArray(data)) {
      if (data.length === 1) return { ok: true, stage: "done" };
      if (data.length === 0) return { ok: false, stage: "partial", reason: "sin_fila" };
      console.error("profile_update_multiple_rows", data.length);
      return { ok: false, stage: "partial", reason: "multiples_filas" };
    }
    // Sólo el código: nunca el mensaje interno, ni credenciales, ni tokens.
    console.error("profile_flag_update_failed", attempt, error?.code ?? "unknown");
    if (attempt < retries) await sleep(200 * attempt);
  }
  return { ok: false, stage: "partial", reason: "error" };
}

export const PARTIAL_MESSAGE =
  "La contraseña se ha cambiado, pero no se pudo completar la actualización del perfil. El acceso sigue bloqueado; vuelve a intentarlo.";
