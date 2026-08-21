// Rellena distrito/barrio reales de cada edificio por geocodificación inversa
// (Nominatim/OpenStreetMap) a partir de las coordenadas de Catastro.
// Nunca inventa: si la respuesta no trae distrito, el edificio se queda vacío.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

const UA = 'AffluxOS/1.0 (contacto: soporte@affluxosv2.world)';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** OSM devuelve a veces «Salamanca (04)»; guardamos el nombre limpio. */
function limpiaNombre(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const n = v.replace(/\s*\(\d+\)\s*$/, '').replace(/\s*-\s*/g, ' - ').trim();
  return n || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // Mismo esquema de autorización que el cotejo masivo.
  const secret = req.headers.get('x-cotejo-key') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  let autorizado = secret === serviceKey || authHeader === serviceKey;
  if (!autorizado && secret) {
    const { data: tok } = await admin.from('internal_tokens')
      .select('token').eq('name', 'cotejo_run').maybeSingle();
    autorizado = !!tok?.token && secret === tok.token;
  }
  if (!autorizado && authHeader) {
    const { data: userData } = await admin.auth.getUser(authHeader);
    if (userData?.user) {
      const { data: roles } = await admin.from('user_roles')
        .select('role').eq('user_id', userData.user.id).eq('role', 'admin');
      autorizado = !!roles && roles.length > 0;
    }
  }
  if (!autorizado) return json({ ok: false, error: 'No autorizado.' }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* sin cuerpo */ }
  const lote = Math.max(1, Math.min(Number(body.lote) || 25, 60));

  const { data: pendientes, error } = await admin
    .from('catastro_data')
    .select('building_id, lat, lon, buildings!inner(id, distrito)')
    .not('lat', 'is', null)
    .is('buildings.distrito', null)
    .limit(lote);
  if (error) return json({ ok: false, error: error.message }, 500);

  let resueltos = 0;
  let sin_distrito = 0;
  const errores: string[] = [];

  for (const fila of pendientes ?? []) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&addressdetails=1&lat=${fila.lat}&lon=${fila.lon}`;
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es' } });
      if (!res.ok) { errores.push(`${fila.building_id}: HTTP ${res.status}`); await sleep(1100); continue; }
      const data = await res.json();
      const a = data?.address ?? {};
      const distrito = limpiaNombre(a.city_district ?? a.district ?? a.borough);
      const barrio = limpiaNombre(a.suburb ?? a.neighbourhood ?? a.quarter);
      if (!distrito && !barrio) { sin_distrito++; await sleep(1100); continue; }
      const patch: Record<string, string> = {};
      if (distrito) patch.distrito = distrito;
      if (barrio) patch.barrio = barrio;
      const { error: upErr } = await admin.from('buildings').update(patch).eq('id', fila.building_id);
      if (upErr) errores.push(`${fila.building_id}: ${upErr.message}`);
      else resueltos++;
    } catch (e) {
      errores.push(`${fila.building_id}: ${(e as Error).message}`);
    }
    await sleep(1100); // Nominatim: máximo 1 petición por segundo.
  }

  const { count: quedan } = await admin
    .from('buildings').select('id', { count: 'exact', head: true }).is('distrito', null);

  return json({
    ok: true,
    procesados: pendientes?.length ?? 0,
    resueltos,
    sin_distrito,
    pendientes: quedan ?? null,
    errores: errores.slice(0, 10),
  });
});
