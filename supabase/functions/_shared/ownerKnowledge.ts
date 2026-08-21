export type KnowledgeSource = {
  clave: string;
  label: string;
  hubspotProperty: string;
};

export const HUBSPOT_DIAGNOSTIC_FIELDS: KnowledgeSource[] = [
  { clave: "whatsapp_abierto", label: "Canal WhatsApp abierto", hubspotProperty: "whatsapp_abierto" },
  { clave: "predisposicion", label: "Predisposición a vender", hubspotProperty: "predisposicion_a_vender" },
  { clave: "interes_reunion", label: "Interés en reunión", hubspotProperty: "interes_en_reunion" },
  { clave: "quien_bloquea", label: "Quién o qué bloquea", hubspotProperty: "quien_o_que_bloquea" },
  { clave: "razon_no_venta", label: "Razón de no venta", hubspotProperty: "razon_de_no_venta" },
  { clave: "decide_solo", label: "¿Decide solo o en familia?", hubspotProperty: "decide_solo" },
  { clave: "vive_en_edificio", label: "¿Vive en el edificio?", hubspotProperty: "vive_en_el_edificio" },
  { clave: "necesidad_liquidez", label: "Necesidad de liquidez", hubspotProperty: "necesidad_de_liquidez" },
  { clave: "motivacion_urgencia", label: "Motivación / urgencia", hubspotProperty: "motivacion__urgencia" },
  { clave: "oferta_previa", label: "¿Ha recibido oferta previa?", hubspotProperty: "ha_recibido_alguna_oferta_previa" },
  { clave: "tipologia", label: "Tipología del propietario (T1–T10)", hubspotProperty: "tipologia_de_propietario" },
  { clave: "biografia", label: "Biografía / contexto del propietario", hubspotProperty: "biografia_historia_del_propietario" },
  { clave: "contacto_preferido", label: "Canal de contacto preferido", hubspotProperty: "como_prefieres_ser_contactado" },
  { clave: "tipo_derecho", label: "Tipo de derecho", hubspotProperty: "tipo_de_derecho" },
  { clave: "porcentaje_participacion", label: "Porcentaje de participación", hubspotProperty: "porcentaje_de_participacion" },
];

export const HUBSPOT_DIAGNOSTIC_PROPERTY_NAMES = HUBSPOT_DIAGNOSTIC_FIELDS.map((f) => f.hubspotProperty);

export function isHubspotYes(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLocaleLowerCase("es-ES");
  return ["sí", "si", "yes", "true", "1", "abierto", "autorizado"].includes(normalized);
}

export function diagnosticKnowledge(metadata: unknown): Array<{
  clave: string;
  label: string;
  estado: "tenemos";
  evidencia: string;
  fuente: "hubspot";
  fecha: null;
}> {
  const source = metadata && typeof metadata === "object" ? metadata as Record<string, unknown> : {};
  return HUBSPOT_DIAGNOSTIC_FIELDS.flatMap((field) => {
    const raw = source[field.hubspotProperty];
    const value = String(raw ?? "").trim();
    if (!value) return [];
    const evidencia = field.clave === "whatsapp_abierto" && isHubspotYes(value)
      ? "WhatsApp autorizado"
      : value;
    return [{
      clave: field.clave,
      label: field.label,
      estado: "tenemos" as const,
      evidencia,
      fuente: "hubspot" as const,
      fecha: null,
    }];
  });
}

/**
 * Registra el consentimiento que el CLIENTE tiene marcado en su CRM.
 *
 * Importante: esto NO es evidencia nuestra. Se guarda con origen 'cliente'
 * y una cita que dice exactamente de dónde viene, para no confundirlo con
 * un consentimiento detectado en una llamada. Si el registro de HubSpot lo
 * escribimos nosotros (señal previa con escrito_en_hubspot=true), no se
 * cuenta como consentimiento de origen cliente: sería el sistema
 * validándose a sí mismo.
 */
export async function materializeHubspotConsent(
  supabase: any,
  ownerId: string,
  contactId: string,
  properties: Record<string, unknown>,
): Promise<boolean> {
  if (!isHubspotYes(properties.whatsapp_abierto)) return false;

  // ¿Ese "sí" de HubSpot lo pusimos nosotros? Entonces no es fuente independiente.
  const { data: previas } = await supabase
    .from("wa_consent_signals")
    .select("id, escrito_en_hubspot, origen")
    .eq("owner_id", ownerId)
    .eq("escrito_en_hubspot", true)
    .limit(1);
  const loEscribimosNosotros = Array.isArray(previas) && previas.length > 0;

  const now = new Date().toISOString();
  const { error } = await supabase.from("wa_consent_signals").upsert({
    owner_id: ownerId,
    hs_call_id: `hubspot:contact:${contactId}:whatsapp_abierto`,
    veredicto: "autorizado",
    cita_textual: "Marcado como canal WhatsApp abierto en el CRM del cliente (sin cita de llamada).",
    telefono: properties.phone || properties.mobilephone || null,
    confianza: loEscribimosNosotros ? 0 : 0.5,
    fecha_llamada: properties.lastmodifieddate || now,
    detectado_at: now,
    escrito_en_hubspot: true,
    fuente: "hubspot",
    origen: loEscribimosNosotros ? "sistema" : "cliente",
    review_status: loEscribimosNosotros ? "pendiente_revision" : null,
    review_reason: loEscribimosNosotros
      ? "circular: el sí de HubSpot lo escribió nuestro sistema"
      : null,
  }, { onConflict: "owner_id,hs_call_id" });
  if (error) throw error;

  // owners.consentimiento sólo se enciende con consentimiento de origen cliente.
  if (!loEscribimosNosotros) {
    const { error: ownerError } = await supabase.from("owners").update({ consentimiento: true }).eq("id", ownerId);
    if (ownerError) throw ownerError;
  }
  return !loEscribimosNosotros;
}
