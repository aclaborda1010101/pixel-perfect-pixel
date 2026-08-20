// Trae de HubSpot el campo "Tipo de Derecho" (tipo_de_derecho) de todos los
// contactos y lo guarda en owners.metadatos. HubSpot es la fuente de verdad:
// aquí sólo copiamos el dato tal cual; las reglas registrales se aplican después.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders, hubspotFetch } from '../_shared/hubspot.ts';

const BATCH = 100;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const maxContacts = Number(body?.max ?? 20000);

    let offset = Number(body?.offset ?? 0);
    let leidos = 0;
    let actualizados = 0;
    const porTipo: Record<string, number> = {};

    while (leidos < maxContacts) {
      const { data: rows, error } = await supabase
        .from('owners')
        .select('id, metadatos')
        .not('metadatos->>_hubspot_contact_id', 'is', null)
        .is('merged_into', null)
        .order('id')
        .range(offset, offset + BATCH - 1);
      if (error) throw new Error(error.message);
      if (!rows || rows.length === 0) break;
      offset += rows.length;
      leidos += rows.length;

      const byHsId = new Map<string, { id: string; metadatos: any }>();
      for (const r of rows) {
        const hsId = String((r.metadatos as any)?._hubspot_contact_id ?? '');
        if (hsId) byHsId.set(hsId, r as any);
      }
      if (byHsId.size === 0) continue;

      const res = await hubspotFetch('/crm/v3/objects/contacts/batch/read', {
        method: 'POST',
        body: JSON.stringify({
          properties: ['tipo_de_derecho', 'porcentaje_de_participacion'],
          inputs: [...byHsId.keys()].map((id) => ({ id })),
        }),
      });

      const pendientes: Array<{ id: string; metadatos: Record<string, unknown>; tipo: string | null }> = [];
      for (const c of res?.results ?? []) {
        const row = byHsId.get(String(c.id));
        if (!row) continue;
        const tipo = c.properties?.tipo_de_derecho ?? null;
        const pct = c.properties?.porcentaje_de_participacion ?? null;
        const prev = (row.metadatos ?? {}) as Record<string, unknown>;
        if (prev.tipo_de_derecho === tipo && prev.porcentaje_de_participacion === pct) continue;
        pendientes.push({
          id: row.id,
          metadatos: { ...prev, tipo_de_derecho: tipo, porcentaje_de_participacion: pct },
          tipo,
        });
      }

      // Escrituras en paralelo controlado: el cuello de botella era hacerlas de una en una.
      const CONC = 20;
      for (let i = 0; i < pendientes.length; i += CONC) {
        const trozo = pendientes.slice(i, i + CONC);
        const res2 = await Promise.all(
          trozo.map((p) => supabase.from('owners').update({ metadatos: p.metadatos }).eq('id', p.id)),
        );
        const fallo = res2.find((r) => r.error);
        if (fallo?.error) throw new Error(fallo.error.message);
        for (const p of trozo) {
          actualizados++;
          const k = p.tipo ?? 'sin_valor';
          porTipo[k] = (porTipo[k] ?? 0) + 1;
        }
      }

      if (rows.length < BATCH) break;
    }

    return new Response(JSON.stringify({ ok: true, leidos, actualizados, porTipo }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[hubspot_backfill_tipo_derecho]', msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
