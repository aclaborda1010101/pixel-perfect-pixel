// Guardia de no-solapamiento para trabajos programados.
// Si la ejecución anterior sigue viva (lock no caducado), la nueva sale sin trabajo.
// El lock caduca solo (TTL) para que un crash no deje el trabajo bloqueado.

export type JobLock = { acquired: boolean; release: () => Promise<void> };

export async function acquireJobLock(
  sb: any,
  jobName: string,
  ttlSeconds = 240,
): Promise<JobLock> {
  const holder = `${jobName}:${crypto.randomUUID()}`;
  const { data, error } = await sb.rpc("try_acquire_job_lock", {
    p_job_name: jobName,
    p_ttl_seconds: ttlSeconds,
    p_holder: holder,
  });
  if (error) {
    console.error(`[jobLock] ${jobName} rpc error: ${error.message}`);
    // Fail-open controlado: si el lock no está disponible no bloqueamos la operación.
    return { acquired: true, release: async () => {} };
  }
  const acquired = data === true;
  return {
    acquired,
    release: async () => {
      if (!acquired) return;
      const { error: relErr } = await sb.rpc("release_job_lock", { p_job_name: jobName });
      if (relErr) console.error(`[jobLock] release ${jobName}: ${relErr.message}`);
    },
  };
}

export function lockedResponse(jobName: string, corsHeaders: Record<string, string>) {
  return new Response(
    JSON.stringify({ ok: true, skipped: "already_running", job: jobName }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
