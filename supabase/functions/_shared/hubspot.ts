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
  'dealname', 'dealstage', 'pipeline', 'amount', 'address', 'city', 'zip', 'country',
  'createdate', 'hs_lastmodifieddate',
  // custom Afflux
  'cadastral_reference', 'total_m2', 'm2_residential', 'm2_commercial',
  'temperature', 'tipo_de_activo___inmueble', 'verificado', 'tenemos_la_nota_simple',
  'prioridad_del_activo', 'precio_del_vendedor__exacto_', 'precio_del_vendedor__rango_',
  'barrios_completos', 'distrito_zona', 'valoracion_viviendas', 'valoracion_locales____',
  'tipo_de_oportunidad',
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
];

export function getServiceClient() {
  // Lazy import para no romper el bundle si no se usa
  // @ts-ignore
  const { createClient } = globalThis.__supabaseModule || {};
  return createClient;
}