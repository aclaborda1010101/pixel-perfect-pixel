// learn_from_calls — agrega tácticas usadas en llamadas evaluadas y actualiza call_playbook.
// Lee public.calls (con tacticas_usadas y/o metadatos.voss_eval), correlaciona con
// owners.buyer_persona y señales de éxito (duracion>=60s, outcome positivo, opt-in).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const POSITIVE_OUTCOMES = new Set([
  'interesado', 'reunion_agendada', 'info_extraida', 'opt_in', 'whatsapp_enviado',
  'derivado_influencer', 'segundo_contacto',
]);

function classifyTipo(t: string): string {
  const s = (t || '').toLowerCase();
  if (/apertur|pattern|contrato|gratitud/.test(s)) return 'apertura';
  if (/etiquet|label/.test(s)) return 'etiqueta';
  if (/objec|rgpd|datos|precio|no\s*me\s*interes/.test(s)) return 'objecion';
  if (/cierre|opt[-_ ]?in|whatsapp|micro[-_ ]?compromiso/.test(s)) return 'cierre';
  if (/pregunt|embudo|calibrada|espejo/.test(s)) return 'pregunta';
  return 'otro';
}

function normTact(t: string): string {
  return String(t || '').trim().toLowerCase().replace(/\s+/g, '_').slice(0, 80);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // 1) Llamadas con táctica registrada
    const { data: calls, error } = await sb
      .from('calls')
      .select('id, owner_id, outcome, duracion_seg, tacticas_usadas, metadatos, analyzed_at')
      .not('tacticas_usadas', 'is', null)
      .limit(2000);
    if (error) throw error;
    const rows = (calls || []).filter((c: any) => Array.isArray(c.tacticas_usadas) && c.tacticas_usadas.length > 0);

    // 2) Map owner -> perfil
    const ownerIds = Array.from(new Set(rows.map((r: any) => r.owner_id).filter(Boolean)));
    const perfilByOwner: Record<string, string> = {};
    if (ownerIds.length) {
      const { data: ow } = await sb.from('owners').select('id, buyer_persona').in('id', ownerIds);
      for (const o of ow || []) perfilByOwner[(o as any).id] = (o as any).buyer_persona || 'sin_clasificar';
    }

    // 3) Agregar
    type Agg = { n_usos: number; n_exito: number; ejemplo: string | null; evid: any[] };
    const bucket = new Map<string, Agg>();
    for (const c of rows) {
      const perfil = perfilByOwner[c.owner_id] || 'sin_clasificar';
      const success =
        (c.duracion_seg || 0) >= 60 ||
        (c.outcome && POSITIVE_OUTCOMES.has(String(c.outcome))) ||
        Boolean(c.metadatos?.opt_in_whatsapp) ||
        Boolean(c.metadatos?.info_minima_ok);
      for (const tRaw of c.tacticas_usadas as string[]) {
        const t = normTact(tRaw);
        if (!t) continue;
        const tipo = classifyTipo(t);
        const key = `${perfil}::${tipo}::${t}`;
        const cur = bucket.get(key) || { n_usos: 0, n_exito: 0, ejemplo: null, evid: [] };
        cur.n_usos += 1;
        if (success) cur.n_exito += 1;
        if (!cur.ejemplo && c.metadatos?.ejemplo_literal) cur.ejemplo = String(c.metadatos.ejemplo_literal).slice(0, 400);
        cur.evid.push({ call_id: c.id, owner_id: c.owner_id, outcome: c.outcome, duracion_seg: c.duracion_seg, success });
        bucket.set(key, cur);
      }
    }

    // 4) Upsert
    const rowsOut: any[] = [];
    for (const [key, agg] of bucket.entries()) {
      const [perfil, tipo, texto] = key.split('::');
      rowsOut.push({
        perfil_tipologia: perfil,
        tactica_tipo: tipo,
        tactica_texto: texto,
        ejemplo_literal: agg.ejemplo,
        n_usos: agg.n_usos,
        n_exito: agg.n_exito,
        tasa_exito: agg.n_usos > 0 ? Number((agg.n_exito / agg.n_usos).toFixed(4)) : 0,
        evidencia: agg.evid.slice(0, 25),
        ultima_actualizacion: new Date().toISOString(),
      });
    }

    let upserted = 0;
    if (rowsOut.length) {
      const { error: upErr, count } = await sb
        .from('call_playbook')
        .upsert(rowsOut, { onConflict: 'perfil_tipologia,tactica_tipo,tactica_texto', count: 'exact' });
      if (upErr) throw upErr;
      upserted = count || rowsOut.length;
    }

    return new Response(JSON.stringify({
      ok: true,
      calls_consideradas: rows.length,
      tacticas_agregadas: rowsOut.length,
      filas_upsert: upserted,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});