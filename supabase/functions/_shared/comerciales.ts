// Mapa canónico hs_owner_id → email del comercial (Afflux).
// Fuente única de verdad. NUNCA mandar correo a agustin.cifuentes@outlook.es.
export type Comercial = { hs_owner_id: string; email: string; nombre: string };

export const COMERCIALES: Comercial[] = [
  { hs_owner_id: "76826178", email: "jesus.anzola@afflux.es",  nombre: "Jesús" },
  { hs_owner_id: "76826175", email: "david.casero@afflux.es",  nombre: "David" },
];

// Recipientes del email "reunión agendada por el bot": jesus + david + carlos.
export const RECIPIENTES_REUNION_BOT = [
  "jesus.anzola@afflux.es",
  "david.casero@afflux.es",
  "carlos.moreno@afflux.es",
];

export const FALLBACK_COMERCIAL_EMAIL = "jesus.anzola@afflux.es";

export function emailForHsOwner(hs_owner_id: string | number | null | undefined): string {
  const id = String(hs_owner_id ?? "").trim();
  const c = COMERCIALES.find((x) => x.hs_owner_id === id);
  return c?.email ?? FALLBACK_COMERCIAL_EMAIL;
}

export function nombreForHsOwner(hs_owner_id: string | number | null | undefined): string {
  const id = String(hs_owner_id ?? "").trim();
  return COMERCIALES.find((x) => x.hs_owner_id === id)?.nombre ?? "Comercial";
}

// Sanea listas de destinatarios: quita duplicados, blanks y bloquea la
// dirección prohibida heredada de una instrucción antigua.
export function sanitizeRecipients(list: (string | null | undefined)[]): string[] {
  const blocked = new Set(["agustin.cifuentes@outlook.es"]);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const e = String(raw ?? "").trim().toLowerCase();
    if (!e || blocked.has(e) || seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}