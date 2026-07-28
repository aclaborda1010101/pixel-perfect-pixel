// sync_owner_birthdates — trae date_of_birth de HubSpot y normaliza a owners.fecha_nacimiento
// Formatos soportados: 1966-03-19, 01/10/1991, 19/03/1966, 1924 (solo año → 1 jul), NO CONSTA, vacío, con tabuladores.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { hubspotFetch, corsHeaders } from '../_shared/hubspot.ts';

const PAGE_LIMIT = 100;
const MAX_PAGES = 200; // 200 x 100 = 20k contactos (cubre 3.982)

function parseDob(raw: string | null | undefined): { date: string | null; approx: boolean } {
  if (!raw) return { date: null, approx: false };
  const s = String(raw).replace(/[\t\r\n]+/g, ' ').trim();
  if (!s || /^no\s*consta$/i.test(s) || /^n\/?a$/i.test(s) || /^-+$/.test(s)) {
    return { date: null, approx: false };
  }
  const currentYear = new Date().getFullYear();
  const validYear = (y: number) => y >= 1900 && y <= currentYear;

  // ISO YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const [_, y, mo, d] = m;
    const yi = +y, mi = +mo, di = +d;
    if (validYear(yi) && mi >= 1 && mi <= 12 && di >= 1 && di <= 31) {
      return { date: `${y}-${String(mi).padStart(2,'0')}-${String(di).padStart(2,'0')}`, approx: false };
    }
  }
  // DD/MM/YYYY o DD-MM-YYYY
  m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  if (m) {
    const di = +m[1], mi = +m[2], yi = +m[3];
    if (validYear(yi) && mi >= 1 && mi <= 12 && di >= 1 && di <= 31) {
      return { date: `${yi}-${String(mi).padStart(2,'0')}-${String(di).padStart(2,'0')}`, approx: false };
    }
  }
  // Solo año
  m = s.match(/^(\d{4})$/);
  if (m) {
    const yi = +m[1];
    if (validYear(yi)) return { date: `${yi}-07-01`, approx: true };
  }
  return { date: null, approx: false };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let scanned = 0, matched = 0, updated = 0, invalid = 0, pages = 0;
  const errors: string[] = [];

  try {
    let after: string | undefined;
    for (let p = 0; p < MAX_PAGES; p++) {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_LIMIT));
      params.set('archived', 'false');
      params.append('properties', 'date_of_birth');
      params.append('properties', 'firstname');
      params.append('properties', 'lastname');
      if (after) params.set('after', after);

      const data = await hubspotFetch(`/crm/v3/objects/contacts?${params.toString()}`);
      pages++;
      const results: any[] = data?.results || [];
      if (!results.length) break;

      for (const c of results) {
        scanned++;
        const dob = c.properties?.date_of_birth;
        if (!dob) continue;

        const { date, approx } = parseDob(dob);
        if (!date) { invalid++; continue; }

        // Match owner via external_ids
        const { data: ext } = await supabase
          .from('external_ids').select('entity_id')
          .eq('provider', 'hubspot')
          .eq('provider_object_type', 'contact')
          .eq('provider_id', c.id)
          .maybeSingle();
        if (!ext?.entity_id) continue;
        matched++;

        const { error: upErr } = await supabase
          .from('owners')
          .update({
            fecha_nacimiento: date,
            metadatos: { fecha_nacimiento_aproximada: approx, fecha_nacimiento_source: 'hubspot', fecha_nacimiento_raw: dob },
          })
          .eq('id', ext.entity_id);
        if (upErr) errors.push(`${c.id}: ${upErr.message}`);
        else updated++;
      }

      after = data?.paging?.next?.after;
      if (!after) break;
    }

    // Estadísticas post
    const { count: n85 } = await supabase.from('owners').select('id', { count: 'exact', head: true })
      .gte('edad_anios', 85).is('merged_into', null);
    const { count: n90 } = await supabase.from('owners').select('id', { count: 'exact', head: true })
      .gte('edad_anios', 90).is('merged_into', null);
    const { count: nCon } = await supabase.from('owners').select('id', { count: 'exact', head: true })
      .not('fecha_nacimiento', 'is', null).is('merged_into', null);

    return new Response(JSON.stringify({
      ok: true, pages, scanned, matched, updated, invalid,
      owners_con_fecha: nCon, mayores_85: n85, mayores_90: n90,
      errors: errors.slice(0, 20),
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({
      ok: false, error: String(e?.message || e), pages, scanned, matched, updated,
    }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});