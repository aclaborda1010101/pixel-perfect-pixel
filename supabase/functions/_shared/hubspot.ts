// Helper compartido para llamar al gateway HubSpot de Lovable
export const HUBSPOT_GATEWAY = 'https://connector-gateway.lovable.dev/hubspot';

export function hubspotHeaders(): Record<string, string> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');
  const HUBSPOT_API_KEY = Deno.env.get('HUBSPOT_API_KEY');
  if (!HUBSPOT_API_KEY) throw new Error('HUBSPOT_API_KEY is not configured');
  return {
    'Authorization': `Bearer ${LOVABLE_API_KEY}`,
    'X-Connection-Api-Key': HUBSPOT_API_KEY,
    'Content-Type': 'application/json',
  };
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

export async function hubspotFetch(path: string, init?: RequestInit) {
  const url = `${HUBSPOT_GATEWAY}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...hubspotHeaders(), ...(init?.headers || {}) },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!res.ok) {
    throw new Error(`HubSpot ${path} ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

// Properties que queremos pedir a HubSpot para Deals (edificios)
export const DEAL_PROPERTIES = [
  // estándar
  'dealname', 'dealstage', 'pipeline', 'amount', 'address',
  'createdate', 'hs_lastmodifieddate', 'closedate', 'hubspot_owner_id',
  // métricas asociaciones / probabilidad
  'num_associated_contacts', 'hs_deal_stage_probability',
  // calculadas útiles
  'hs_is_closed', 'hs_is_closed_won', 'hs_is_closed_lost', 'hs_closed_won_count',
  'hs_days_to_close_raw', 'hs_v2_time_in_current_stage', 'hs_forecast_amount',
  'hs_v2_date_entered_current_stage',
  // custom Afflux (verified internal names)
  'referencia_catastral',
  'metros_cuadrados__exactos_',
  'dividido',
  'verificado',
  'tenemos_la_nota_simple_',
  'prioridad_del_activo',
  'distrito_zona__clonada_',
  'barrios_completos__clonada_',
  'tipo_de_activo___inmueble__clonada_',
  'tipo_de_oportunidad__clonada_',
  'valoracion_viviendas',
  'valoracion_locales',
  'valoracion_viviendas___clonada_',
  'metros_cuadrados__exactos____clonada_',
  'precio_del_vendedor__exacto___clonada_',
  'precio_del_vendedor__rango___clonada_',
  // distribución de usos (HubSpot custom)
  'metros_cuadrados__rango_',
  'viviendas__unidades_',
  'viviendas__unidades___clonada_',
  'metros_cuadrados_viviendas',
  'metros_cuadrados_viviendas___clonada_',
  'comercio__unidades_',
  'metros_cuadrados_comercio',
  'oficina__unidades_',
  'metros_cuadrado_oficina',
  'metros_cuadrados_oficina',
  'almacen__unidades_',
  'metros_cuadrados_almacen',
  'aparcamiento__unidades_',
  'elementos_comunes__unidades_',
  'metros_cuadrados_elementos_comunes',
  'ocio_hostel__unidades_',
  'metros_cuadrados_ocio_hostel',
  'industrial__unidades_',
  'metros_cuadrados_industrial',
];

// Properties para Contacts (propietarios + leads + inversores)
export const CONTACT_PROPERTIES = [
  // estándar
  'firstname', 'lastname', 'email', 'phone', 'lifecyclestage', 'hs_lead_status',
  'createdate', 'lastmodifieddate',
  // custom Afflux
  'dni__nif__cif', 'biografia_historia_del_propietario', 'porcentaje_de_participacion',
  'monday_id', 'barrios_completos', 'distrito_zona', 'fuente', 'tipologia_de_propietario',
  'direccion_del_edificio', 'ano_de_nacimiento', 'tipo_de_inversor',
  'capital_de_inversion', 'telefono_secundario', 'telefono_terciario',
  // D.2 enrich
  'associatedcompanyid', 'motivo_venta', 'empresa_propia', 'edad',
  'relacion_familiar', 'profesion', 'situacion', 'primer_apellido',
  'fecha_nacimiento', 'lugar_residencia', 'anos_propietario',
];

// (no helper extra; cada función importa createClient directamente)