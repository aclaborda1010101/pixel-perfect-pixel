// auditar_direcciones_catastro
// Comprueba, edificio a edificio, que la dirección que tenemos coincide con la
// que dice el Catastro para su referencia catastral. Sólo lee Catastro.
// Escribe el resultado en public.catastro_direccion_audit.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UA = 'AffluxProperty/1.0 (acifuentes@abius.es)';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const TIPOS_VIA =
  /(^|\s)(calle|c\/|cl|c\.|avenida|avda|av|paseo|ps|po|plaza|pl|pza|glorieta|gta|ronda|rda|travesia|camino|carretera|ctra|via|cr|tr|gl|pj|pasaje)(\s|\.)+/g;

export function normVia(p: string | null | undefined): string {
  const base = (p ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/g, 'n');
  return base
    .replace(TIPOS_VIA, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nombreVia(p: string | null | undefined): string {
  return normVia(p).replace(/\d.*$/, '').trim();
}

export function numeroVia(p: string | null | undefined): number | null {
  const m = normVia(p).match(/(\d{1,4})/);
  return m ? Number(m[1]) : null;
}

// Dos nombres de vía se consideran la misma si comparten todas las palabras
// significativas (>2 letras) de la más corta.
export function mismaVia(a: string, b: string): boolean {
  const na = nombreVia(a);
  const nb = nombreVia(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = new Set(na.split(' ').filter((w) => w.length > 2));
  const tb = new Set(nb.split(' ').filter((w) => w.length > 2));
  if (!ta.size || !tb.size) return false;
  const [chico, grande] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  for (const w of chico) if (!grande.has(w)) return false;
  return true;
}

export type Comparacion = { coincide: boolean; motivo: string | null };

export function compararDirecciones(nuestra: string, catastro: string): Comparacion {
  if (!catastro) return { coincide: false, motivo: 'catastro_sin_direccion' };
  if (!mismaVia(nuestra, catastro)) return { coincide: false, motivo: 'calle_distinta' };
  const nn = numeroVia(nuestra);
  const nc = numeroVia(catastro);
  if (nn != null && nc != null && nn !== nc) {
    return { coincide: false, motivo: Math.abs(nn - nc) <= 2 ? 'numero_proximo' : 'numero_distinto' };
  }
  return { coincide: true, motivo: null };
}

function pick(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i').exec(xml);
  return m?.[1]?.trim() || null;
}

async function direccionCatastro(rc14: string): Promise<{ dir: string | null; via: string | null; num: number | null; error?: string }> {
  const url =
    `https://ovc.catastro.meh.es/ovcservweb/OVCSWLocalizacionRC/OVCCallejero.asmx/Consulta_DNPRC?Provincia=&Municipio=&RC=${encodeURIComponent(rc14)}`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/xml' } });
    const xml = await r.text();
    const tv = pick(xml, 'tv');
    const nv = pick(xml, 'nv');
    const pnp = pick(xml, 'pnp');
    if (nv) {
      const dir = [tv, nv, pnp].filter(Boolean).join(' ');
      return { dir, via: nv, num: pnp ? Number(pnp) : null };
    }
    const ldt = pick(xml, 'ldt');
    if (ldt) return { dir: ldt, via: nombreVia(ldt), num: numeroVia(ldt) };
    const errDesc = pick(xml, 'des');
    return { dir: null, via: null, num: null, error: errDesc ?? 'sin_respuesta' };
  } catch (e) {
    return { dir: null, via: null, num: null, error: String((e as Error)?.message ?? e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const secret = req.headers.get('x-audit-key') ?? '';
  let autorizado = auth === service || (!!secret && secret === service);
  if (!autorizado && secret) {
    const { data: tok } = await admin.from('internal_tokens')
      .select('token').eq('name', 'auditoria_catastro').maybeSingle();
    autorizado = !!tok?.token && secret === tok.token;
  }
  if (!autorizado && auth) {
    const { data: userData } = await admin.auth.getUser(auth);
    if (userData?.user) {
      const { data: roles } = await admin.from('user_roles')
        .select('role').eq('user_id', userData.user.id).eq('role', 'admin');
      autorizado = !!roles && roles.length > 0;
    }
  }
  if (!autorizado) return json({ ok: false, error: 'No autorizado.' }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* sin cuerpo */ }
  const lote = Math.min(120, Math.max(1, Number(body.lote ?? 60)));
  const rehacer = body.rehacer === true;
  const soloIds = Array.isArray(body.building_ids) ? (body.building_ids as string[]) : null;

  let q = admin.from('buildings')
    .select('id, direccion, refcatastral')
    .not('refcatastral', 'is', null)
    .order('id', { ascending: true })
    .limit(2000);
  if (soloIds) q = q.in('id', soloIds);
  const { data: edificios, error } = await q;
  if (error) return json({ ok: false, error: error.message }, 500);

  let candidatos = (edificios ?? []).filter((b) => (b.refcatastral ?? '').length >= 14);
  if (!rehacer && !soloIds) {
    const { data: ya } = await admin.from('catastro_direccion_audit').select('building_id');
    const hechos = new Set((ya ?? []).map((r) => r.building_id));
    candidatos = candidatos.filter((b) => !hechos.has(b.id));
  }
  candidatos = candidatos.slice(0, lote);

  if (candidatos.length === 0) {
    return json({ ok: true, terminado: true, procesados: 0 });
  }

  const filas: Record<string, unknown>[] = [];
  let noCoinciden = 0;
  for (const b of candidatos) {
    const rc14 = String(b.refcatastral).slice(0, 14);
    const cat = await direccionCatastro(rc14);
    const cmp = cat.dir
      ? compararDirecciones(String(b.direccion ?? ''), cat.dir)
      : { coincide: false, motivo: cat.error ?? 'catastro_sin_direccion' };
    if (!cmp.coincide) noCoinciden++;
    filas.push({
      building_id: b.id,
      refcatastral_14: rc14,
      direccion_nuestra: b.direccion,
      direccion_catastro: cat.dir,
      via_catastro: cat.via,
      numero_catastro: cat.num,
      coincide: cmp.coincide,
      motivo: cmp.motivo,
      checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  const { error: upErr } = await admin.from('catastro_direccion_audit')
    .upsert(filas, { onConflict: 'building_id' });
  if (upErr) return json({ ok: false, error: upErr.message }, 500);

  const { count: pendientes } = await admin.from('buildings')
    .select('id', { count: 'exact', head: true })
    .not('refcatastral', 'is', null);
  const { count: hechos } = await admin.from('catastro_direccion_audit')
    .select('building_id', { count: 'exact', head: true });

  return json({
    ok: true,
    procesados: filas.length,
    no_coinciden_en_esta_pasada: noCoinciden,
    auditados_total: hechos ?? 0,
    con_referencia_total: pendientes ?? 0,
    terminado: (hechos ?? 0) >= (pendientes ?? 0),
  });
});
