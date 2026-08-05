// assign_daily_call_queue — Motor V5 de tareas (Centros Comerciales V2).
// Catálogo operativo: T-01, T-02, T-03, T-04, T-05, T-06, T-08, T-09.
// T-07 excluido por decisión del cliente. No publica nada en HubSpot.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const TZ = 'Europe/Madrid';
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dmyFmt = new Intl.DateTimeFormat('es-ES', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });

function madridYmd(d = new Date()) { return ymdFmt.format(d); }

/** Instante de las 23:59:59 en Europe/Madrid del día indicado (ISO UTC). */
function madridEndOfDayIso(ymd: string): string {
  const naive = Date.parse(`${ymd}T23:59:59Z`);
  // Offset real de Madrid en esa fecha (calculado, no hardcodeado).
  const asUtc = new Date(naive);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(asUtc).reduce<Record<string, string>>((a, p) => (a[p.type] = p.value, a), {});
  const local = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour === '24' ? '00' : parts.hour}:${parts.minute}:${parts.second}Z`);
  return new Date(naive - (local - naive)).toISOString();
}

const CATALOGO: Record<string, { label: string; que: string; priority: string; orden: number }> = {
  'T-01': { label: 'Investigación previa', priority: 'medium', orden: 5, que: 'Investigar al propietario para conseguir un teléfono válido antes de intentar la llamada.' },
  'T-02': { label: 'Primera llamada', priority: 'high', orden: 1, que: 'Realizar la primera llamada de contacto y cualificación.' },
  'T-03': { label: 'WhatsApp / contenido', priority: 'medium', orden: 3, que: 'Enviar por WhatsApp el contenido acordado con el propietario.' },
  'T-04': { label: 'Cadencia', priority: 'medium', orden: 4, que: 'Retomar el contacto porque la cadencia acordada está vencida.' },
  'T-05': { label: 'Completar ficha', priority: 'low', orden: 6, que: 'Completar los datos que faltan en la ficha del propietario.' },
  'T-06': { label: 'Verificación de datos', priority: 'medium', orden: 7, que: 'Verificar un dato del edificio marcado como incoherente o pendiente.' },
  'T-08': { label: 'Revisión de oportunidad', priority: 'high', orden: 2, que: 'Revisar la oportunidad abierta y confirmar cita con fecha.' },
  'T-09': { label: 'Kill / Park review', priority: 'low', orden: 8, que: 'Revisar si el edificio debe aparcarse o reactivarse. No es un cierre automático.' },
};
const CODES = Object.keys(CATALOGO);
// Para la cobertura de catálogo se empieza por los tipos más escasos, de modo que
// un propietario compartido no deje sin representación a un tipo con pocos candidatos.
const CODES_COBERTURA = ['T-08', 'T-03', 'T-09', 'T-06', 'T-05', 'T-04', 'T-01', 'T-02'];

// Fallback seguro por nombre de comercial en buildings.comercial → emails de perfil.
const COMERCIALES = [
  { nombre: 'David Casero Gallego', emails: ['david.casero@afflux.es'] },
  { nombre: 'Jesus Anzola', emails: ['jesus@afflux.es', 'jesus.anzola@afflux.es'] },
];

const fmtDate = (v: any) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : dmyFmt.format(d);
};

function evidenciaTexto(code: string, c: any): string[] {
  const e = c.evidencia ?? {};
  const out: string[] = [];
  const push = (k: string, v: any) => { if (v !== null && v !== undefined && v !== '' ) out.push(`${k}: ${v}`); };
  switch (code) {
    case 'T-01':
      push('Teléfono en CRM', e.telefono ? e.telefono : 'sin teléfono');
      push('Llamadas registradas', e.llamadas ?? 0);
      break;
    case 'T-02':
      push('Teléfono', e.telefono);
      push('Llamadas registradas', 0);
      break;
    case 'T-03':
      push('Veredicto de consentimiento', e.veredicto ?? 'consentimiento marcado en ficha');
      push('Cita textual', e.cita ? `“${String(e.cita).slice(0, 220)}”` : null);
      push('Fecha de la señal', fmtDate(e.senal_fecha));
      push('Último WhatsApp', fmtDate(e.ultimo_whatsapp) ?? 'ninguno registrado');
      break;
    case 'T-04':
      push('Último resultado', e.ultimo_outcome ?? 'sin resultado');
      push('Fecha', fmtDate(e.fecha));
      push('Días transcurridos', e.dias);
      push('Acción vencida', e.accion_vencida);
      push('Vencimiento', fmtDate(e.vencimiento));
      break;
    case 'T-05':
      push('Campos que faltan', Array.isArray(e.faltan) ? e.faltan.join(', ') : null);
      push('Llamadas registradas', e.llamadas);
      push('Última llamada', fmtDate(e.ultima_llamada));
      break;
    case 'T-06':
      push('Guardas pendientes', e.guardas_pendientes);
      push('Guarda', e.guarda);
      push('Detalle', e.detalle ? String(e.detalle).slice(0, 220) : null);
      push('Suma de cuotas', e.suma_cuotas != null ? `${e.suma_cuotas}%` : null);
      push('Relaciones con cuota', e.relaciones_con_cuota);
      break;
    case 'T-08':
      push('Último resultado', e.ultimo_outcome);
      push('Fecha de esa llamada', fmtDate(e.fecha));
      push('Días desde entonces', e.dias);
      break;
    case 'T-09':
      push('Titulares con teléfono', e.titulares_con_telefono);
      push('Contactados', e.contactados);
      push('Última actividad', fmtDate(e.ultima_actividad));
      break;
  }
  return out;
}

function porQueHoy(code: string, c: any): string {
  const e = c.evidencia ?? {};
  switch (code) {
    case 'T-01': return 'El propietario está asociado al edificio pero no hay teléfono válido: sin este paso no se puede llamar.';
    case 'T-02': return 'Hay teléfono válido y nunca se ha llamado: es el siguiente contacto natural.';
    case 'T-03': return 'El propietario autorizó WhatsApp y todavía no se le ha enviado nada después de esa señal.';
    case 'T-04': return `Han pasado ${e.dias ?? '—'} días desde la última señal (${e.ultimo_outcome ?? 'sin resultado'}) o hay una acción vencida.`;
    case 'T-05': return 'Ya hay contacto previo, así que la información recogida debe consolidarse en la ficha.';
    case 'T-06': return 'Hay un dato marcado como pendiente o incoherente que puede invalidar el resto del trabajo.';
    case 'T-08': return 'La última llamada terminó como interesado: la ventana de oportunidad está abierta.';
    case 'T-09': return 'Todos los titulares contactables ya lo han sido y no hay novedad en 90 días.';
    default: return 'Priorizado por el motor V5.';
  }
}

function buildDescription(code: string, c: any, dueYmd: string): string {
  const cat = CATALOGO[code];
  const ev = evidenciaTexto(code, c);
  const supuestos: string[] = [];
  if (c.owner_id && c.estado_vital && c.estado_vital !== 'activo') supuestos.push(`Estado vital del propietario: ${c.estado_vital}.`);
  supuestos.push('Backlog histórico de HubSpot no computa: esta tarea nace del motor V5 y solo vence hoy.');
  if (!c.assignment) supuestos.push(`Asignación derivada de buildings.comercial (${c.comercial ?? 'sin comercial'}), no de building_assignments.`);
  return [
    `QUÉ: ${cat.que}`,
    `DISPARADOR V5 (${code} ${cat.label}): ${c.motivo}`,
    `EVIDENCIA / DATOS: ${ev.length ? ev.join(' · ') : 'Sin datos adicionales registrados.'}`,
    `POR QUÉ HOY: ${porQueHoy(code, c)}`,
    `OBJETIVO: ${c.objetivo}`,
    `FECHA LÍMITE: hoy ${fmtDate(`${dueYmd}T12:00:00Z`)} a las 23:59 (Europe/Madrid).`,
    `SUPUESTOS: ${supuestos.join(' ')}`,
  ].join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const perUser = Math.max(1, Math.min(50, Number(body.per_user ?? body.n ?? 10)));
    const replaceToday = body.replace_today === true;
    const ensureCoverage = body.ensure_catalog_coverage !== false;
    const dryRun = body.dry_run === true;
    const explicitUsers: string[] | null = Array.isArray(body.user_ids)
      ? body.user_ids
      : (body.user_id ? [body.user_id] : null);

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const hoy = madridYmd();
    const dueIso = madridEndOfDayIso(hoy);

    // 1) Resolver comerciales (perfil por email) + fallback buildings.comercial
    const { data: profiles } = await sb.from('profiles').select('id, email, full_name');
    const byEmail = new Map((profiles ?? []).map((p: any) => [String(p.email ?? '').toLowerCase(), p]));
    const byId = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    type Target = { user_id: string; nombre: string; label: string };
    const targets: Target[] = [];
    for (const c of COMERCIALES) {
      const prof = c.emails.map((e) => byEmail.get(e)).find(Boolean);
      if (prof) targets.push({ user_id: (prof as any).id, nombre: c.nombre, label: (prof as any).full_name || (prof as any).email });
    }
    if (explicitUsers) {
      for (const uid of explicitUsers) {
        if (targets.some((t) => t.user_id === uid)) continue;
        const prof: any = byId.get(uid);
        const nombre = COMERCIALES.find((c) => c.emails.includes(String(prof?.email ?? '').toLowerCase()))?.nombre ?? '';
        targets.push({ user_id: uid, nombre, label: prof?.full_name || prof?.email || uid });
      }
      // Si se pasan usuarios explícitos, limitamos a ellos.
      targets.splice(0, targets.length, ...targets.filter((t) => explicitUsers.includes(t.user_id)));
    }
    if (!targets.length) {
      return new Response(JSON.stringify({ ok: false, error: 'no_targets' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // 2) replace_today: borra SOLO pendientes del motor V5 de hoy de esos usuarios
    let deleted = 0;
    if (replaceToday && !dryRun) {
      const { data: del } = await sb.from('building_tasks')
        .delete()
        .in('user_id', targets.map((t) => t.user_id))
        .eq('status', 'pending')
        .like('task_key', `v5:${hoy}:%`)
        .select('id');
      deleted = (del ?? []).length;
    }

    // 3) Candidatos por comercial
    const takenOwners = new Set<string>();
    const takenKeys = new Set<string>();
    const yaPorUsuario = new Map<string, number>();
    const { data: existentes } = await sb.from('building_tasks')
      .select('task_key, user_id, status').like('task_key', `v5:${hoy}:%`);
    for (const t of existentes ?? []) {
      const key = String((t as any).task_key);
      takenKeys.add(key);
      // El sujeto (owner o building) ya tiene tarea hoy: no duplicar con otro T-XX.
      const idKey = key.split(':')[3];
      if (idKey) { takenOwners.add(`o:${idKey}`); takenOwners.add(`b:${idKey}`); }
      const uid = String((t as any).user_id);
      yaPorUsuario.set(uid, (yaPorUsuario.get(uid) ?? 0) + 1);
    }

    const resumen: any[] = [];
    const insertados: any[] = [];

    for (const target of targets) {
      const { data: assigns } = await sb.from('building_assignments')
        .select('building_id').eq('user_id', target.user_id).eq('status', 'active');
      const assignedIds = new Set<string>((assigns ?? []).map((a: any) => a.building_id));

      // Se consulta por tipo (PostgREST limita a 1.000 filas por petición) para
      // garantizar cobertura real de catálogo con los mejores candidatos de cada T-XX.
      const rows: any[] = [];
      const ids = [...assignedIds];
      for (const code of CODES) {
        for (let i = 0; i < ids.length; i += 150) {
          const { data } = await sb.from('v_v5_task_candidates').select('*')
            .eq('task_code', code).in('building_id', ids.slice(i, i + 150))
            .order('prioridad', { ascending: false }).limit(40);
          for (const r of data ?? []) rows.push({ ...r, assignment: true });
        }
        if (target.nombre) {
          const { data } = await sb.from('v_v5_task_candidates').select('*')
            .eq('task_code', code).eq('comercial', target.nombre)
            .order('prioridad', { ascending: false }).limit(60);
          for (const r of data ?? []) if (!assignedIds.has(r.building_id)) rows.push({ ...r, assignment: false });
        }
      }

      // Dedupe por (building, owner, code) y ordenación por prioridad
      const seen = new Set<string>();
      const cands = rows.filter((r) => {
        const k = `${r.building_id}:${r.owner_id}:${r.task_code}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }).sort((a, b) => Number(b.prioridad ?? 0) - Number(a.prioridad ?? 0));

      const picked: any[] = [];
      const usedOwners = new Set<string>();
      const pick = (c: any) => {
        const ownerKey = c.task_code === 'T-09' ? `b:${c.building_id}` : `o:${c.owner_id}`;
        if (usedOwners.has(ownerKey) || takenOwners.has(ownerKey)) return false;
        const idKey = c.task_code === 'T-09' ? c.building_id : c.owner_id;
        const taskKey = `v5:${hoy}:${c.task_code}:${idKey}`;
        if (takenKeys.has(taskKey)) return false;
        usedOwners.add(ownerKey); takenOwners.add(ownerKey); takenKeys.add(taskKey);
        picked.push({ ...c, task_key: taskKey });
        return true;
      };

      // 3a) Cobertura de catálogo: al menos una tarea de cada tipo con candidato real
      if (ensureCoverage) {
        for (const code of CODES_COBERTURA) {
          if (picked.length >= perUser) break;
          // Se prueban varios candidatos: el mejor puede tener ya otra tarea del día.
          for (const c of cands.filter((x) => x.task_code === code).slice(0, 40)) {
            if (pick(c)) break;
          }
        }
      }
      // 3b) Relleno por prioridad
      for (const c of cands) {
        if (picked.length >= perUser) break;
        pick(c);
      }

      for (const c of picked) {
        const cat = CATALOGO[c.task_code];
        const sujeto = c.task_code === 'T-09' ? (c.direccion ?? 'Edificio') : `${c.direccion ?? 'Edificio'} · ${c.nombre ?? 'Propietario'}`;
        const row = {
          building_id: c.building_id,
          user_id: target.user_id,
          task_type: 'call_queue',
          task_key: c.task_key,
          title: `${c.task_code} ${cat.label} — ${sujeto}`,
          description: buildDescription(c.task_code, c, hoy),
          priority: cat.priority,
          status: 'pending',
          due_date: dueIso,
        };
        if (dryRun) { insertados.push({ ...row, dry_run: true }); continue; }
        const { data: ins, error: insErr } = await sb.from('building_tasks').insert(row).select('id, task_key').maybeSingle();
        if (ins) insertados.push({ ...ins, user_id: target.user_id, task_code: c.task_code });
        else if (insErr) console.error('insert err', c.task_key, JSON.stringify(insErr));
      }

      const disponibles: Record<string, number> = {};
      for (const c of cands) disponibles[c.task_code] = (disponibles[c.task_code] ?? 0) + 1;
      const porTipo: Record<string, number> = {};
      for (const p of picked) porTipo[p.task_code] = (porTipo[p.task_code] ?? 0) + 1;
      resumen.push({ user_id: target.user_id, comercial: target.label, generadas: picked.length, por_tipo: porTipo, disponibles_por_tipo: disponibles, candidatos: cands.length });
    }

    return new Response(JSON.stringify({
      ok: true, fecha: hoy, due_date: dueIso, replace_today: replaceToday, dry_run: dryRun,
      borradas: deleted, inserted: insertados.length, resumen, items: insertados,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});