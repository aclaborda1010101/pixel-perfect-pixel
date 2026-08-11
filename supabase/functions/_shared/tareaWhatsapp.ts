/** Utilidades compartidas por las funciones edge del bloque de WhatsApp. */
import { parseGeneratedTaskKey } from './whatsappTarjeta.ts';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

export type Contexto = {
  userId: string;
  esAdmin: boolean;
  tarea: any;
  owner: any;
  edificio: any;
};

/** Resuelve usuario, tarea, propietario y edificio. Falla cerrado. */
export async function resolverContexto(
  admin: any,
  authed: any,
  token: string,
  taskId: unknown,
  ownerIdPedido: unknown,
): Promise<{ error: Response } | { ctx: Contexto }> {
  if (typeof taskId !== 'string' || taskId.trim() === '') {
    return { error: json(400, { ok: false, error: 'falta_task_id' }) };
  }
  const { data: claims, error: cErr } = await authed.auth.getClaims(token);
  const userId = !cErr && claims?.claims?.sub ? String(claims.claims.sub) : null;
  if (!userId) return { error: json(401, { ok: false, error: 'no_autenticado' }) };

  const { data: roles } = await admin.from('user_roles').select('role').eq('user_id', userId);
  const esAdmin = (roles ?? []).some((r: any) => String(r.role) === 'admin');

  const { data: tarea } = await admin
    .from('building_tasks')
    .select('id,user_id,building_id,task_type,task_key,status')
    .eq('id', taskId)
    .maybeSingle();
  if (!tarea) return { error: json(404, { ok: false, error: 'tarea_no_encontrada' }) };
  if (tarea.user_id !== userId && !esAdmin) {
    return { error: json(403, { ok: false, error: 'tarea_de_otro_comercial' }) };
  }
  if (tarea.task_type !== 'T-02_03') {
    return { error: json(400, { ok: false, error: 'tipo_de_tarea_no_admitido' }) };
  }

  const clave = parseGeneratedTaskKey(tarea.task_key);
  const candidato =
    typeof ownerIdPedido === 'string' && ownerIdPedido.trim() !== ''
      ? ownerIdPedido
      : clave?.subjectId ?? null;
  if (!candidato) return { error: json(400, { ok: false, error: 'propietario_no_identificado' }) };

  const { data: owner } = await admin
    .from('owners')
    .select('id,nombre,nombre_display,telefono')
    .eq('id', candidato)
    .maybeSingle();
  if (!owner) return { error: json(400, { ok: false, error: 'propietario_no_identificado' }) };

  // El propietario debe estar vinculado al edificio de la tarea.
  const { data: vinculo } = await admin
    .from('building_owners')
    .select('owner_id')
    .eq('building_id', tarea.building_id)
    .eq('owner_id', owner.id)
    .maybeSingle();
  if (!vinculo) return { error: json(400, { ok: false, error: 'propietario_no_pertenece_al_edificio' }) };

  const { data: edificio } = await admin
    .from('buildings')
    .select('id,direccion,ciudad')
    .eq('id', tarea.building_id)
    .maybeSingle();

  return { ctx: { userId, esAdmin, tarea, owner, edificio } };
}
