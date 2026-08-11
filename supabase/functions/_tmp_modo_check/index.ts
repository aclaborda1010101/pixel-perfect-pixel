// TEMPORAL — verificación de aceptación de modos. Se elimina tras la prueba.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

Deno.serve(async (req) => {
  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const body = await req.json();
  const modo = String(body.modo);
  const userId = String(body.user_id);
  const n = Number(body.n ?? 6);

  await admin.from('work_modes').update({ activo: false }).eq('scope', 'global').neq('mode', modo);
  await admin.from('work_modes').update({ activo: true }).eq('scope', 'global').eq('mode', modo);

  const creadas: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await fetch(`${url}/functions/v1/generate_next_task`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${service}`, apikey: service, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user_id: userId }),
    });
    const j = await r.json();
    creadas.push(j?.tipo ?? j?.reason ?? j?.error ?? 'sin_respuesta');
  }
  return new Response(JSON.stringify({ modo, creadas }), { headers: { 'Content-Type': 'application/json' } });
});
