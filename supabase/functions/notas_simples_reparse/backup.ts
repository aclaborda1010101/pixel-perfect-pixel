// BACKUP VERIFICADO ANTES DE SOBRESCRIBIR STORAGE (P0.8).
//
// La reingesta sustituye un binario en Storage. Antes del overwrite es
// OBLIGATORIO dejar una copia y COMPROBARLA (bytes + sha256 releídos del
// destino). Si el backup falla o no verifica: NO se sobrescribe. Nunca.

import { sha256Hex } from "./pdf.ts";

export type BackupDeps = {
  upload: (path: string, bytes: Uint8Array) => Promise<{ error?: { message?: string } | null } | void>;
  download: (path: string) => Promise<Uint8Array | null>;
};

export type BackupResult =
  | { ok: true; path: string; size: number; sha256: string }
  | { ok: false; reason: string; path: string };

export function backupPath(fileUrl: string, now = Date.now()): string {
  return `reingest-backup/${fileUrl}.${now}.bak`;
}

export async function backupVerificado(
  deps: BackupDeps,
  args: { fileUrl: string; bytes: Uint8Array; now?: number },
): Promise<BackupResult> {
  const path = backupPath(args.fileUrl, args.now ?? Date.now());
  const originalSha = await sha256Hex(args.bytes);
  if (!originalSha) return { ok: false, reason: "sha256_no_disponible", path };

  try {
    const up: any = await deps.upload(path, args.bytes);
    if (up?.error) return { ok: false, reason: `upload_fail:${String(up.error.message ?? "error").slice(0, 120)}`, path };
  } catch (e) {
    return { ok: false, reason: `upload_exception:${String((e as Error)?.message ?? e).slice(0, 120)}`, path };
  }

  let leido: Uint8Array | null = null;
  try {
    leido = await deps.download(path);
  } catch (e) {
    return { ok: false, reason: `readback_exception:${String((e as Error)?.message ?? e).slice(0, 120)}`, path };
  }
  if (!leido) return { ok: false, reason: "readback_vacio", path };
  if (leido.length !== args.bytes.length) {
    return { ok: false, reason: `readback_size:${leido.length}!=${args.bytes.length}`, path };
  }
  const shaLeido = await sha256Hex(leido);
  if (shaLeido !== originalSha) {
    return { ok: false, reason: "readback_sha_distinto", path };
  }
  return { ok: true, path, size: args.bytes.length, sha256: originalSha };
}
