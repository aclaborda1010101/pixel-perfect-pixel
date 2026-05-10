// hubspot_research — read-only audit de HubSpot para preparar pasos 3-7.
// No muta nada. Devuelve bloques estructurados.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { hubspotFetch, corsHeaders, DEAL_PROPERTIES, CONTACT_PROPERTIES } from '../_shared/hubspot.ts';

const COMPANY_PROPERTIES_LOCAL = [
  'name', 'domain', 'phone', 'address', 'city', 'zip', 'country',
  'createdate', 'hs_lastmodifieddate',
  'cif', 'dni__nif__cif', 'tipologia_de_propietario',
  'distrito_zona', 'barrios_completos',
];

async function safe<T>(p: Promise<T>): Promise<T | { __error: string }> {
  try { return await p; } catch (e: any) { return { __error: String(e?.message || e).slice(0, 400) }; }
}

async function fieldCoverage(objectType: string, propertyName: string): Promise<number | null> {
  // search count for prop has_property
  try {
    const r: any = await hubspotFetch(`/crm/v3/objects/${objectType}/search`, {
      method: 'POST',
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName, operator: 'HAS_PROPERTY' }] }],
        limit: 1,
      }),
    });
    return typeof r?.total === 'number' ? r.total : null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const t0 = Date.now();
  const out: any = {};

  // Total counts (denominadores) para coverage
  const dealsTotal: any = await safe(hubspotFetch(`/crm/v3/objects/deals?limit=1&archived=false`));
  const contactsTotal: any = await safe(hubspotFetch(`/crm/v3/objects/contacts?limit=1&archived=false`));
  const companiesTotal: any = await safe(hubspotFetch(`/crm/v3/objects/companies?limit=1&archived=false`));
  // search to get total
  const dealsSearch: any = await safe(hubspotFetch(`/crm/v3/objects/deals/search`, { method: 'POST', body: JSON.stringify({ limit: 1 }) }));
  const contactsSearch: any = await safe(hubspotFetch(`/crm/v3/objects/contacts/search`, { method: 'POST', body: JSON.stringify({ limit: 1 }) }));
  const companiesSearch: any = await safe(hubspotFetch(`/crm/v3/objects/companies/search`, { method: 'POST', body: JSON.stringify({ limit: 1 }) }));
  out.totals = {
    deals: dealsSearch?.total ?? null,
    contacts: contactsSearch?.total ?? null,
    companies: companiesSearch?.total ?? null,
  };

  // ============ 1) WHATSAPP / SMS / MESSAGING ============
  const wa: any = {};
  // a) schemas — custom object types
  const schemas: any = await safe(hubspotFetch(`/crm/v3/schemas`));
  const schemaList = Array.isArray(schemas?.results) ? schemas.results : [];
  wa.custom_objects = schemaList.map((s: any) => ({
    name: s?.name, label: s?.labels?.singular, objectTypeId: s?.objectTypeId, fullyQualifiedName: s?.fullyQualifiedName,
  }));
  wa.custom_objects_matching = schemaList.filter((s: any) =>
    /(whatsapp|sms|message)/i.test(`${s?.name} ${s?.labels?.singular} ${s?.fullyQualifiedName}`)
  );

  // b) engagements types — HubSpot estándar: CALL/EMAIL/MEETING/NOTE/TASK + COMMUNICATION (sms/whatsapp/linkedin)
  // Sample some COMMUNICATION engagements
  const comm: any = await safe(hubspotFetch(`/crm/v3/objects/communications?limit=20&properties=hs_communication_channel_type,hs_communication_body,hs_timestamp`));
  wa.communications_sample = {
    total_in_page: Array.isArray(comm?.results) ? comm.results.length : 0,
    channels_seen: Array.from(new Set((comm?.results || []).map((c: any) => c?.properties?.hs_communication_channel_type).filter(Boolean))),
    error: comm?.__error || null,
  };
  const commSearch: any = await safe(hubspotFetch(`/crm/v3/objects/communications/search`, {
    method: 'POST',
    body: JSON.stringify({ limit: 1 }),
  }));
  wa.communications_total = commSearch?.total ?? null;

  // c) contact / company props con whatsapp/sms
  const contactProps: any = await safe(hubspotFetch(`/crm/v3/properties/contacts`));
  const contactPropList: any[] = contactProps?.results || [];
  wa.contact_props_messaging = contactPropList
    .filter((p) => /(whatsapp|sms|wa_)/i.test(`${p?.name} ${p?.label}`))
    .map((p) => ({ name: p?.name, label: p?.label, type: p?.type }));

  const companyProps: any = await safe(hubspotFetch(`/crm/v3/properties/companies`));
  const companyPropList: any[] = companyProps?.results || [];
  wa.company_props_messaging = companyPropList
    .filter((p) => /(whatsapp|sms|wa_)/i.test(`${p?.name} ${p?.label}`))
    .map((p) => ({ name: p?.name, label: p?.label, type: p?.type }));

  // d) installed apps — endpoint puede no estar disponible vía gateway
  const apps: any = await safe(hubspotFetch(`/integrations/v1/installed-applications`));
  wa.installed_apps_raw = apps?.__error
    ? { error: apps.__error }
    : (Array.isArray(apps?.results) ? apps.results.map((a: any) => ({ name: a?.applicationName || a?.name, id: a?.applicationId || a?.id })) : apps);

  // e) lists con whatsapp/wa
  const { data: lists } = await supabase.from('hubspot_lists').select('hs_list_id, name, list_type, size').or('name.ilike.%whatsapp%,name.ilike.%wa %,name.ilike.%sms%');
  wa.lists_local_match = lists || [];
  out.whatsapp = wa;

  // ============ 2) DEAL PROPERTIES AUDIT ============
  const dealProps: any = await safe(hubspotFetch(`/crm/v3/properties/deals`));
  const dealPropList: any[] = dealProps?.results || [];
  const sourceMap = new Map(dealPropList.map((p) => [p.name, p]));
  const requested = new Set(DEAL_PROPERTIES);
  const all = dealPropList.map((p) => ({ name: p.name, label: p.label, type: p.type, calculated: !!p.calculated, calculation_formula: p.calculationFormula || null, requested: requested.has(p.name) }));
  // missing high-value: pedir coverage para una lista de candidatos comunes + custom Afflux
  const candidates = ['amount', 'closedate', 'dealtype', 'zip', 'codigo_postal', 'fecha_estimada_cierre', 'hubspot_owner_id', 'hs_priority', 'hs_deal_stage_probability', 'description', 'pipeline', 'closed_won_reason', 'closed_lost_reason', 'num_associated_contacts', 'hs_acv', 'fecha_de_cierre__exacta_', 'fecha_de_captacion'];
  const dealCoverage: Record<string, number | null> = {};
  await Promise.all(candidates.filter((c) => sourceMap.has(c) && !requested.has(c)).map(async (c) => {
    dealCoverage[c] = await fieldCoverage('deals', c);
  }));
  out.deals = {
    total_props: dealPropList.length,
    requested_count: DEAL_PROPERTIES.length,
    requested_existing: DEAL_PROPERTIES.filter((p) => sourceMap.has(p)),
    requested_missing_in_hubspot: DEAL_PROPERTIES.filter((p) => !sourceMap.has(p)),
    candidate_coverage: dealCoverage, // {name: count_with_value}
    total_deals_for_pct: out.totals.deals,
    all_props: all,
  };

  // ============ 3) COMPANY PROPERTIES AUDIT ============
  const requestedCo = new Set(COMPANY_PROPERTIES_LOCAL);
  const coAll = companyPropList.map((p) => ({ name: p.name, label: p.label, type: p.type, calculated: !!p.calculated, calculation_formula: p.calculationFormula || null, requested: requestedCo.has(p.name) }));
  const coCandidates = ['industry', 'numberofemployees', 'country', 'city', 'lifecyclestage', 'domain', 'website', 'founded_year', 'annualrevenue', 'description', 'type', 'hubspot_owner_id', 'is_public', 'hs_lead_status'];
  const coCoverage: Record<string, number | null> = {};
  await Promise.all(coCandidates.filter((c) => companyPropList.find((p) => p.name === c) && !requestedCo.has(c)).map(async (c) => {
    coCoverage[c] = await fieldCoverage('companies', c);
  }));
  out.companies = {
    total_props: companyPropList.length,
    requested_count: COMPANY_PROPERTIES_LOCAL.length,
    requested_existing: COMPANY_PROPERTIES_LOCAL.filter((p) => companyPropList.find((q) => q.name === p)),
    requested_missing_in_hubspot: COMPANY_PROPERTIES_LOCAL.filter((p) => !companyPropList.find((q) => q.name === p)),
    candidate_coverage: coCoverage,
    total_companies_for_pct: out.totals.companies,
    all_props: coAll,
  };

  // ============ 4) CONTACT PROPS GAP ============
  const requestedC = new Set(CONTACT_PROPERTIES);
  // Para no quemarnos, limitamos coverage a props no pedidas más interesantes
  const cInteresting = contactPropList
    .filter((p) => !requestedC.has(p.name) && !p.hubspotDefined === false) // include custom + default
    .filter((p) => !/^hs_/.test(p.name)) // exclude internal
    .map((p) => p.name);
  // limitar a top 60 por nombre
  const cSample = cInteresting.slice(0, 60);
  const cCoverage: Record<string, number | null> = {};
  await Promise.all(cSample.map(async (c) => { cCoverage[c] = await fieldCoverage('contacts', c); }));
  // filtrar coverage > 30% sobre total contacts
  const cTotal = out.totals.contacts || 0;
  const cGapHigh = Object.entries(cCoverage)
    .filter(([_, v]) => typeof v === 'number' && cTotal > 0 && (v as number) / cTotal > 0.3)
    .map(([k, v]) => ({ name: k, count_with_value: v, pct: cTotal ? Math.round(((v as number) / cTotal) * 1000) / 10 : null }))
    .sort((a, b) => (b.pct || 0) - (a.pct || 0));
  out.contacts = {
    total_props: contactPropList.length,
    requested_count: CONTACT_PROPERTIES.length,
    sampled_for_gap: cSample.length,
    gap_high_coverage: cGapHigh,
  };

  // ============ 5) PIPELINES & STAGES ============
  const pipelines: any = await safe(hubspotFetch(`/crm/v3/pipelines/deals`));
  out.pipelines = {
    deals: (pipelines?.results || []).map((p: any) => ({
      id: p?.id, label: p?.label,
      stages: (p?.stages || []).map((s: any) => ({ id: s?.id, label: s?.label, displayOrder: s?.displayOrder, metadata: s?.metadata })),
    })),
    matches_inversores: (pipelines?.results || []).filter((p: any) => /inversor|capt/i.test(p?.label || '')).map((p: any) => p?.label),
  };

  // ============ 6) CALCULATED PROPERTIES across the 3 objects ============
  out.calculated_properties = {
    deals: dealPropList.filter((p) => p.calculated).map((p) => ({ name: p.name, label: p.label, formula: p.calculationFormula })),
    contacts: contactPropList.filter((p) => p.calculated).map((p) => ({ name: p.name, label: p.label, formula: p.calculationFormula })),
    companies: companyPropList.filter((p) => p.calculated).map((p) => ({ name: p.name, label: p.label, formula: p.calculationFormula })),
  };

  return new Response(JSON.stringify({ ok: true, latencia_ms: Date.now() - t0, ...out }, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});