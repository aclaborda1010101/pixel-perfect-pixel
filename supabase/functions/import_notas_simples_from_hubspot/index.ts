// import_notas_simples_from_hubspot — escanea HubSpot Files (PDF) cuyo nombre
// contenga "nota simple" / "nota_simple" / "-NS" / "Nota Simple" (case-insensitive),
// descarga, sube a bucket Supabase 'notas-simples', crea fila notas_simples
// auto-vinculada a building (fuzzy match por dirección o catastro_ref), y dispara
// analyze_nota_simple. Idempotente por metadatos.hs_file_id.
//
// Body opcional: { chain?: bool=true, max_pages?: number, dry_run?: bool }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { corsHeaders } from '../_shared/hubspot.ts';

// Direct HubSpot API (bypass gateway) usando Private App Token con scopes files/files.ui_hidden.read
const HUBSPOT_API = 'https://api.hubapi.com';
function patHeaders(): Record<string, string> {
  const pat = Deno.env.get('HUBSPOT_PAT');
  if (!pat) throw new Error('HUBSPOT_PAT is not configured');
  return {
    'Authorization': `Bearer ${pat}`,
    'Content-Type': 'application/json',
  };
}
async function hsDirect(path: string, init?: RequestInit) {
  const res = await fetch(`${HUBSPOT_API}${path}`, {
    ...init,
    headers: { ...patHeaders(), ...(init?.headers || {}) },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!res.ok) throw new Error(`HubSpot ${path} ${res.status}: ${JSON.stringify(body).slice(0,400)}`);
  return body;
}

const PAGE_LIMIT = 100;
const MAX_PAGES_PER_RUN_DEFAULT = 6;
const NAME_REGEX = /(nota[\s_-]*simple|-?NS\b)/i;
const CATASTRO_REGEX = /\b\d{7}[A-Z]{2}\d{4}[A-Z]\d{4}[A-Z]{2}\b/;

function extractAddressFromFilename(name: string): string | null {
  // Quita extensión y separadores tipo "Nota simple", "-NS", "Nota_Simple", etc.
  let n = name.replace(/\.[a-z0-9]+$/i, '');
  n = n.replace(/(nota[\s_-]*simple|-?NS\b|registro|rp\b)/gi, ' ');
  n = n.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  n = n.replace(/^[-\s]+|[-\s]+$/g, '').trim();
  if (!n) return null;
  // Si empieza con número, anteponemos "Calle " (heurística común)
  if (/^\d/.test(n)) return `Calle ${n}`;
  return n;
}

function tokenizeAddress(addr: string): string[] {
  return addr
    .toLowerCase()
    .replace(/[^\w\sáéíóúñü]/gi, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !['calle', 'avda', 'avenida', 'plaza', 'paseo', 'pza', 'pso', 'numero', 'nº'].includes(t));
}

async function findBuildingId(supabase: any, filename: string): Promise<string | null> {
  // 1) catastro_ref en el nombre
  const cm = filename.match(CATASTRO_REGEX);
  if (cm) {
    const { data } = await supabase.from('buildings').select('id').eq('catastro_ref', cm[0]).limit(1).maybeSingle();
    if (data?.id) return data.id;
  }
  // 2) fuzzy por dirección
  const addr = extractAddressFromFilename(filename);
  if (!addr) return null;
  // ILIKE token a token: buscar building cuya dirección contenga TODOS los tokens largos
  const tokens = tokenizeAddress(addr);
  if (tokens.length === 0) return null;
  // Estrategia: busca con el token más largo y filtra en JS por presencia de los demás
  const main = tokens.sort((a, b) => b.length - a.length)[0];
  const { data: cands } = await supabase
    .from('buildings')
    .select('id, direccion')
    .ilike('direccion', `%${main}%`)
    .limit(20);
  if (!cands || cands.length === 0) return null;
  const scored = cands.map((b: any) => {
    const dl = (b.direccion || '').toLowerCase();
    const hits = tokens.filter((t) => dl.includes(t)).length;
    return { id: b.id, hits };
  }).sort((a: any, b: any) => b.hits - a.hits);
  if (scored[0].hits >= Math.max(2, Math.ceil(tokens.length * 0.6))) return scored[0].id;
  return null;
}

async function downloadHubspotFile(fileId: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  // signed-url (direct PAT)
  const signed: any = await hsDirect(`/files/v3/files/${fileId}/signed-url`).catch(() => null);
  const url: string | undefined = signed?.url;
  if (!url) return null;
  const r = await fetch(url);
  if (!r.ok) return null;
  const ab = await r.arrayBuffer();
  return { bytes: new Uint8Array(ab), contentType: r.headers.get('content-type') || 'application/pdf' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const t0 = Date.now();
  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }
  const chain: boolean = body?.chain !== false;
  const dryRun: boolean = !!body?.dry_run;
  const maxPages: number = Number.isFinite(body?.max_pages) ? Number(body.max_pages) : MAX_PAGES_PER_RUN_DEFAULT;

  // Cursor en hubspot_sync_state.entity = 'notas_simples_import'
  const { data: st } = await supabase.from('hubspot_sync_state')
    .select('cursor, metadatos').eq('entity', 'notas_simples_import').maybeSingle();
  let after: string | undefined = st?.cursor || undefined;
  const acc = (st?.metadatos as any) || { found: 0, imported: 0, skipped: 0, linked: 0, unlinked: 0, errors: 0, dispatched: 0 };

  let pages = 0;
  let lastAfter: string | null = after || null;
  let done = false;

  try {
    while (pages < maxPages) {
      // GET /files/v3/files con paginación (PAT directo, no gateway)
      const qs = new URLSearchParams();
      qs.set('limit', String(PAGE_LIMIT));
      if (after) qs.set('after', after);
      qs.set('sort', '-createdAt');
      const res: any = await hsDirect(`/files/v3/files?${qs.toString()}`);
      const items: any[] = Array.isArray(res?.results) ? res.results : [];
      pages++;
      for (const f of items) {
        const name = String(f?.name || '');
        const ext = String(f?.extension || '').toLowerCase();
        const isPdf = ext === 'pdf' || /\.pdf$/i.test(name);
        if (!isPdf) continue;
        if (!NAME_REGEX.test(name)) continue;
        acc.found++;
        const fileId = String(f.id);
        // idempotencia
        const { data: existing } = await supabase.from('notas_simples')
          .select('id').contains('structured_json', { _placeholder: true }) // dummy to force jsonb chain
          .limit(0);
        // mejor: buscar por file_url que codifica hs_file_id
        const { data: ex2 } = await supabase.from('notas_simples')
          .select('id').eq('file_url', `hs_${fileId}.pdf`).maybeSingle();
        if (ex2?.id) { acc.skipped++; continue; }
        if (dryRun) { continue; }
        // 1) building
        const buildingId = await findBuildingId(supabase, name).catch(() => null);
        // 2) descargar PDF
        const dl = await downloadHubspotFile(fileId).catch(() => null);
        if (!dl) { acc.errors++; continue; }
        // 3) subir a bucket
        const objectPath = `hs_${fileId}.pdf`;
        const { error: upErr } = await supabase.storage
          .from('notas-simples')
          .upload(objectPath, dl.bytes, { contentType: 'application/pdf', upsert: true });
        if (upErr) { acc.errors++; continue; }
        // 4) crear fila notas_simples
        const { data: nota, error: insErr } = await supabase.from('notas_simples').insert({
          file_url: objectPath,
          building_id: buildingId,
          status: 'pendiente',
        }).select('id').single();
        if (insErr || !nota) { acc.errors++; continue; }
        acc.imported++;
        if (buildingId) acc.linked++; else acc.unlinked++;
        // 5) registrar metadata del file en agent_runs como traza
        await supabase.from('agent_runs').insert({
          agent_name: 'import_notas_simples_from_hubspot',
          scope_type: 'notas_simples', scope_id: nota.id,
          modelo: 'hubspot_files',
          resultado: { hs_file_id: fileId, name, building_id: buildingId, auto_linked: !!buildingId },
        });
        // 6) disparar analyze_nota_simple (con service role como bearer)
        try {
          const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/analyze_nota_simple`;
          // @ts-ignore
          EdgeRuntime.waitUntil(fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({ nota_simple_id: nota.id }),
          }).catch(() => {}));
          acc.dispatched++;
        } catch { /* swallow */ }
      }
      after = res?.paging?.next?.after;
      lastAfter = after || null;
      if (!after) { done = true; break; }
    }
  } catch (e: any) {
    await supabase.from('hubspot_sync_state').upsert({
      entity: 'notas_simples_import',
      last_run_at: new Date().toISOString(),
      last_run_status: 'error',
      last_error: String(e?.message || e).slice(0, 500),
      cursor: lastAfter,
      metadatos: acc,
    }, { onConflict: 'entity' });
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e), acc }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  await supabase.from('hubspot_sync_state').upsert({
    entity: 'notas_simples_import',
    last_run_at: new Date().toISOString(),
    last_run_status: done ? 'done' : 'continuing',
    cursor: done ? null : lastAfter,
    metadatos: { ...acc, last_chunk_ms: Date.now() - t0 },
  }, { onConflict: 'entity' });

  let chained = false;
  if (chain && !done) {
    try {
      const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/import_notas_simples_from_hubspot`;
      // @ts-ignore
      EdgeRuntime.waitUntil(fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
        body: JSON.stringify({ chain: true }),
      }).catch(() => {}));
      chained = true;
    } catch { /* swallow */ }
  }

  return new Response(JSON.stringify({
    ok: true, pages, done, chained, acc, latencia_ms: Date.now() - t0,
  }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});