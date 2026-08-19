// generate_next_task — GENERADOR CONTINUO DE TAREAS V1.
// Genera UNA sola tarea para un comercial, a partir de edificios con
// porcentajes verificados contra la nota registral, asignados a ese comercial.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import {
  TIPOS,
  type Tipo,
  elegirTipo,
  redactarTarjeta,
  proximaFechaLimite,
  taskKeyFor,
} from '../_shared/generadorTareas.ts';
import { propietariosContactables } from '../_shared/interlocutor.ts';
import { insertGeneratedTask } from '../_shared/taskWriters.ts';
import { agruparLlamadas, calcularCadencia, permiteTipo, type Cadencia } from '../_shared/cadencias.ts';

// Estados del reparto de propiedad que permiten trabajar el edificio.
// «Puedo llamar» y «sé el porcentaje exacto» son dos cosas distintas.
const ESTADOS_LLAMABLES = ['verificado', 'verificado_pendiente_matching', 'a_revisar'];
// Sin nota o sin propietarios sólo cabe investigar: nunca llamar.
const ESTADOS_SOLO_INVESTIGACION = ['sin_nota', 'sin_propietarios'];
const TIPOS_LLAMADA: Tipo[] = ['T-02_03', 'T-04'];

/** Tipos de tarea admisibles según el estado del reparto de propiedad. */
export function tiposPermitidosPorEstado(estado: string | null | undefined): Tipo[] {
  const e = String(estado ?? '');
  if (ESTADOS_SOLO_INVESTIGACION.includes(e)) return ['T-01'];
  if (ESTADOS_LLAMABLES.includes(e)) return [...TIPOS];
  return [];
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '').trim();
  const admin = createClient(url, service, { auth: { persistSession: false } });

  let body: Record<string, unknown> = {};
  try { body = (await req.json()) ?? {}; } catch { body = {}; }

  const isServiceRole = token !== '' && token === service;
  // Llamada interna (cron / verificación operativa) con clave compartida.
  const internalKey = Deno.env.get('GENERATE_TASK_INTERNAL_KEY') ?? '';
  const isInternal =
    internalKey !== '' && (req.headers.get('x-internal-key') ?? '') === internalKey;
  let callerId: string | null = null;
  let roles: string[] = [];
  if (!isServiceRole && !isInternal && token) {
    const authed = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data, error } = await authed.auth.getClaims(token);
    if (!error && data?.claims?.sub) {
      callerId = String(data.claims.sub);
      const { data: rows } = await admin.from('user_roles').select('role').eq('user_id', callerId);
      roles = (rows ?? []).map((r: any) => String(r.role));
    }
  }
  if (!isServiceRole && !isInternal && !callerId) return json(401, { ok: false, error: 'no_autenticado' });

  const pedido = typeof body.p_user_id === 'string' ? body.p_user_id : null;
  const puedeDelegar =
    isServiceRole || isInternal || roles.includes('admin') ||
    roles.includes('sales_manager') || roles.includes('manager');
  const userId = pedido && (puedeDelegar || pedido === callerId) ? pedido : callerId;
  if (!userId) return json(400, { ok: false, error: 'falta_p_user_id' });

  try {
    // 1. Cartera del comercial limitada a edificios con porcentajes verificados.
    const { data: asigs, error: aErr } = await admin
      .from('building_assignments')
      .select('building_id')
      .eq('user_id', userId)
      .eq('status', 'active');
    if (aErr) throw aErr;
    const ids = [...new Set((asigs ?? []).map((a: any) => a.building_id).filter(Boolean))];
    if (ids.length === 0) return json(200, { ok: true, created: null, reason: 'sin_cartera' });

    const edificios: any[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error } = await admin
        .from('buildings')
        .select('id,direccion,ciudad,estado,porcentajes_estado,interlocutor_owner_id')
        .in('porcentajes_estado', [...ESTADOS_LLAMABLES, ...ESTADOS_SOLO_INVESTIGACION])
        .in('id', ids.slice(i, i + 100));
      if (error) throw error;
      edificios.push(...(data ?? []));
    }
    if (edificios.length === 0) return json(200, { ok: true, created: null, reason: 'sin_edificios_trabajables' });

    // 2. Tareas abiertas del comercial: bloquean el mismo tipo en el mismo edificio.
    const { data: abiertas, error: tErr } = await admin
      .from('building_tasks')
      .select('id,building_id,task_type,task_key,status')
      .eq('user_id', userId)
      .in('status', ['pending', 'in_progress']);
    if (tErr) throw tErr;
    const ocupado = new Set((abiertas ?? []).map((t: any) => `${t.building_id}|${t.task_type}`));

    // 3. Histórico del generador para respetar la mezcla de work_modes.
    const { data: historico } = await admin
      .from('building_tasks')
      .select('task_type,created_at')
      .eq('user_id', userId)
      .like('task_key', 'v5:gen1:%')
      .order('created_at', { ascending: false })
      .limit(40);

    // Modo de reparto ACTIVO (global). Se lee en cada generación: sin redespliegue.
    const { data: modo } = await admin
      .from('work_modes')
      .select('mode,mix')
      .eq('scope', 'global')
      .eq('activo', true)
      .limit(1)
      .maybeSingle();

    // 4. Propietarios con derecho vigente en la nota, ordenados por score.
    const propietarios: any[] = [];
    const edifIds = edificios.map((b: any) => b.id);
    for (let i = 0; i < edifIds.length; i += 100) {
      const { data } = await admin
        .from('v_owner_score')
        .select('owner_id,nombre,telefono,building_id,pct_propiedad,pct_origen,score,contactos_previos,last_call_at')
        .in('building_id', edifIds.slice(i, i + 100));
      propietarios.push(...(data ?? []));
    }
    const porEdificio = new Map<string, any[]>();
    for (const o of propietarios) {
      const arr = porEdificio.get(o.building_id) ?? [];
      arr.push(o);
      porEdificio.set(o.building_id, arr);
    }
    for (const arr of porEdificio.values()) {
      arr.sort((a, b) => (Number(b.score ?? 0) - Number(a.score ?? 0)));
    }

    // 4bis. Historial de llamadas por propietario -> situación y fecha de cadencia.
    const ownerIds = [...new Set(propietarios.map((o: any) => o.owner_id).filter(Boolean))];
    const llamadas: any[] = [];
    for (let i = 0; i < ownerIds.length; i += 200) {
      const { data } = await admin
        .from('calls')
        .select('owner_id,fecha,outcome,sentiment,duracion_seg')
        .in('owner_id', ownerIds.slice(i, i + 200));
      llamadas.push(...(data ?? []));
    }
    const porPropietario = agruparLlamadas(llamadas);
    const ahoraRef = new Date();

    // 5. Candidatos por tipo, ordenados por el mejor propietario del edificio.
    const candidatos: Record<Tipo, any[]> = {} as any;
    for (const tipo of TIPOS) candidatos[tipo] = [];
    for (const b of edificios) {
      // Interlocutor activo: sólo se pueden generar tareas hacia esa persona.
      const owners = propietariosContactables(
        (b as any).interlocutor_owner_id ?? null,
        porEdificio.get(b.id) ?? [],
      );
      const top = owners[0] ?? null;
      const conTelefono = owners.find((o: any) => o.telefono) ?? null;
      const puntuacion = Number(top?.score ?? 0);
      const permitidos = tiposPermitidosPorEstado((b as any).porcentajes_estado);
      for (const tipo of permitidos) {
        if (ocupado.has(`${b.id}|${tipo}`)) continue;
        const necesitaPropietario = tipo === 'T-02_03' || tipo === 'T-04';
        const owner = conTelefono ?? top;
        if (necesitaPropietario && !owner) continue;
        // Cadencia por situación del contacto: nunca antes de su fecha,
        // y nunca "primera llamada" a alguien con quien ya se ha hablado.
        let cadencia: Cadencia | null = null;
        if (owner?.owner_id) {
          cadencia = calcularCadencia({
            llamadas: porPropietario.get(String(owner.owner_id)) ?? [],
            estadoEdificio: (b as any).estado ?? null,
            ahora: ahoraRef,
          });
          if ((tipo === 'T-02_03' || tipo === 'T-04') && !permiteTipo(cadencia, tipo)) continue;
        } else if (tipo === 'T-02_03' || tipo === 'T-04') {
          continue;
        }
        candidatos[tipo].push({ building: b, owner, puntuacion, cadencia });
      }
    }
    // La investigación de un propietario ilocalizable tras 3 intentos va primero.
    const prioridad = (c: any, tipo: Tipo) =>
      c.puntuacion + (tipo === 'T-01' && c.cadencia?.situacion === 'no_contactado_agotado' ? 1000 : 0);
    for (const tipo of TIPOS) {
      candidatos[tipo].sort((a, b) => prioridad(b, tipo) - prioridad(a, tipo));
    }

    const disponibles = TIPOS.filter((t) => candidatos[t].length > 0);
    if (disponibles.length === 0) return json(200, { ok: true, created: null, reason: 'sin_candidatos' });

    const tipo = elegirTipo({
      mix: (modo?.mix as Record<string, number> | null) ?? null,
      historico: (historico ?? []).map((h: any) => String(h.task_type)),
      disponibles,
    });
    const elegido = candidatos[tipo][0];

    const tarjeta = redactarTarjeta(tipo, {
      direccion: elegido.building.direccion ?? 'edificio sin dirección',
      ciudad: elegido.building.ciudad ?? null,
      propietario: elegido.owner?.nombre ?? null,
      telefono: elegido.owner?.telefono ?? null,
      participacion: elegido.owner?.pct_propiedad ?? null,
      porcentajesEnRevision: String(elegido.building.porcentajes_estado ?? '') !== 'verificado',
    });

    const ahora = new Date();
    const cad: Cadencia | null = elegido.cadencia ?? null;
    const limite = cad?.fechaLimite ?? proximaFechaLimite(ahora);
    const row = {
      building_id: elegido.building.id,
      user_id: userId,
      task_type: tipo,
      task_key: taskKeyFor(tipo, elegido.building.id, elegido.owner?.owner_id ?? elegido.building.id, ahora),
      title: tarjeta.title,
      description: tarjeta.description,
      objetivo: tarjeta.objetivo,
      pasos_registro: tarjeta.pasos_registro,
      status: 'pending',
      priority: elegido.puntuacion >= 70 ? 'high' : elegido.puntuacion >= 40 ? 'medium' : 'low',
      started_at: ahora.toISOString(),
      due_date: limite.toISOString(),
    };

    const { data: creada, error: iErr } = await insertGeneratedTask(admin, row);
    if (iErr) throw iErr;

    return json(200, { ok: true, created: creada, tipo, situacion: cad?.situacion ?? null });
  } catch (e) {
    return json(500, { ok: false, error: (e as Error)?.message ?? String(e) });
  }
});
