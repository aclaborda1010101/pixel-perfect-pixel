// Reingesta ÚNICA desde HubSpot (P0.7): si el binario almacenado no es un PDF
// válido con páginas, se vuelve a descargar el original con hs_file_id y sólo se
// sustituye en Storage si el binario nuevo es un PDF válido, con páginas y con
// hash DISTINTO. Si sigue inválido => dead-letter invalid_pdf_no_pages, sin bucle.

import { inspectPdf, type PageCounter, type PdfInspection } from "./pdf.ts";

export const HS_GATEWAY = "https://connector-gateway.lovable.dev/hubspot";
/** Marca en structured_json que impide un segundo intento de reingesta. */
export const REINGEST_FLAG = "reingest_attempted";

export type FetchLike = (url: string, init?: any) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<any>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** ¿Procede reingestar? Sólo con binario inválido, hs_file_id y sin intento previo. */
export function decideReingest(args: {
  inspection: PdfInspection;
  hsFileId?: string | null;
  structured?: Record<string, unknown> | null;
}): { reingest: boolean; reason: string } {
  if (args.inspection.ok) return { reingest: false, reason: "pdf_valido" };
  const yaIntentado = (args.structured ?? {})[REINGEST_FLAG];
  if (yaIntentado === true || yaIntentado === "1") {
    return { reingest: false, reason: "reingesta_ya_intentada" };
  }
  const id = String(args.hsFileId ?? "").trim();
  if (!id) return { reingest: false, reason: "sin_hs_file_id" };
  return { reingest: true, reason: `binario_invalido:${args.inspection.reason ?? "desconocido"}` };
}

/** Sólo se sustituye el binario si el nuevo es válido Y su hash cambia. */
export function shouldReplaceStored(args: {
  nueva: PdfInspection;
  shaAnterior: string | null;
}): { replace: boolean; reason: string } {
  if (!args.nueva.ok) return { replace: false, reason: `nuevo_invalido:${args.nueva.reason ?? "desconocido"}` };
  if (args.nueva.sha256 && args.shaAnterior && args.nueva.sha256 === args.shaAnterior) {
    return { replace: false, reason: "hash_identico" };
  }
  return { replace: true, reason: "nuevo_pdf_valido" };
}

/** Descarga el original desde HubSpot a través del connector gateway. */
export async function fetchHubspotPdf(args: {
  hsFileId: string;
  lovableKey: string;
  hubspotKey: string;
  fetchImpl: FetchLike;
  countPages?: PageCounter;
}): Promise<{ ok: true; bytes: Uint8Array; inspection: PdfInspection } | { ok: false; reason: string }> {
  const headers = {
    Authorization: `Bearer ${args.lovableKey}`,
    "X-Connection-Api-Key": args.hubspotKey,
  };
  let signed: string;
  try {
    const r = await args.fetchImpl(`${HS_GATEWAY}/files/v3/files/${args.hsFileId}/signed-url`, { headers });
    if (!r.ok) return { ok: false, reason: `hubspot_signed_url_http_${r.status}:${(await r.text()).slice(0, 200)}` };
    const j = await r.json();
    signed = String(j?.url ?? "");
    if (!signed) return { ok: false, reason: "hubspot_sin_url" };
  } catch (e) {
    return { ok: false, reason: `hubspot_signed_url_excepcion:${String((e as Error)?.message ?? e).slice(0, 160)}` };
  }
  try {
    const d = await args.fetchImpl(signed, {});
    if (!d.ok) return { ok: false, reason: `hubspot_download_http_${d.status}` };
    const bytes = new Uint8Array(await d.arrayBuffer());
    const inspection = await inspectPdf(bytes, { countPages: args.countPages });
    return { ok: true, bytes, inspection };
  } catch (e) {
    return { ok: false, reason: `hubspot_download_excepcion:${String((e as Error)?.message ?? e).slice(0, 160)}` };
  }
}
