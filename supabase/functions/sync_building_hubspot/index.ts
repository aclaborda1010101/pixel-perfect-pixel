// sync_building_hubspot — "Actualizar desde HubSpot" para UN edificio.
// SOLO LECTURA sobre HubSpot; escribe únicamente en nuestra base.
// Disponible para cualquier miembro del equipo con rol asignado.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { corsHeaders } from '../_shared/hubspot.ts';
import { sincronizarEdificioDesdeHubspot, tomarFoto } from '../_shared/hubspotBuildingSync.ts';

const MIN_SEGUNDOS_ENTRE_SYNC = 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // --- Autenticación: exige sesión y rol interno ---
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return json({ ok: false, error: 'Falta la sesión de usuario.' }, 401);
  const { data: userData, error: authErr } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (authErr || !user) return json({ ok: false, error: 'Sesión no válida.' }, 401);
  const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', user.id);
  if (!roles || roles.length === 0) {
    return json({ ok: false, error: 'Tu cuenta no tiene permisos para actualizar edificios.' }, 403);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* sin cuerpo */ }
  const buildingId = typeof body.building_id === 'string' ? body.building_id : '';
  if (!UUID_RE.test(buildingId)) return json({ ok: false, error: 'Edificio no válido.' }, 400);

  const { data: building } = await admin
    .from('buildings').select('id, hs_deal_id, last_synced_at').eq('id', buildingId).maybeSingle();
  if (!building) return json({ ok: false, error: 'Ese edificio no existe.' }, 404);
  if (!building.hs_deal_id) {
    return json({
      ok: false,
      error: 'Este edificio todavía no tiene un negocio asociado en HubSpot, así que no hay nada que traer.',
    }, 409);
  }

  // --- Límite de uso: una vez por minuto y edificio ---
  const { data: ultimo } = await admin
    .from('building_hubspot_sync_log')
    .select('created_at')
    .eq('building_id', buildingId)
    .eq('ok', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ultimo?.created_at) {
    const segundos = (Date.now() - new Date(ultimo.created_at).getTime()) / 1000;
    if (segundos < MIN_SEGUNDOS_ENTRE_SYNC) {
      return json({
        ok: true,
        rate_limited: true,
        espera_segundos: Math.ceil(MIN_SEGUNDOS_ENTRE_SYNC - segundos),
        mensaje: `Acabas de actualizar este edificio. Puedes volver a intentarlo en ${Math.ceil(MIN_SEGUNDOS_ENTRE_SYNC - segundos)} segundos.`,
        last_synced_at: building.last_synced_at,
      });
    }
  }

  const t0 = Date.now();
  const antes = await tomarFoto(admin, buildingId);
  try {
    const stats = await sincronizarEdificioDesdeHubspot(admin, buildingId, String(building.hs_deal_id));
    const despues = await tomarFoto(admin, buildingId);
    const ahora = new Date().toISOString();
    // La fecha solo avanza si la lectura de HubSpot ha ido bien.
    await admin.from('buildings').update({ last_synced_at: ahora }).eq('id', buildingId);
    const resumen = { antes, despues, stats };
    await admin.from('building_hubspot_sync_log').insert({
      building_id: buildingId, user_id: user.id, ok: true,
      resumen, duracion_ms: Date.now() - t0,
    });
    return json({ ok: true, last_synced_at: ahora, ...resumen });
  } catch (e) {
    const mensaje = String((e as Error)?.message ?? e);
    console.error('[sync_building_hubspot]', mensaje);
    await admin.from('building_hubspot_sync_log').insert({
      building_id: buildingId, user_id: user.id, ok: false,
      error: mensaje, duracion_ms: Date.now() - t0,
    });
    return json({
      ok: false,
      error: `No se han podido traer los datos de HubSpot: ${mensaje}`,
      last_synced_at: building.last_synced_at,
    }, 502);
  }
});
