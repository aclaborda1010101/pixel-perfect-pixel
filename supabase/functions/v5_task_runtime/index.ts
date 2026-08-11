// v5_task_runtime — MOTOR V5 P0.3. Runtime server-side REAL.
// Reclama solicitudes con lease, carga contexto del MISMO comercial, ejecuta
// el motor puro y COMMITEA vía RPC transaccional (0 ó 1 tarea production).
// Flag OFF por defecto: con OFF no hay ninguna escritura.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import {
  decideV5Invocation,
  runServerCycle,
  mapDbToV5Context,
  type V5RuntimeConfig,
  type V5ServerRepo,
  type V5CycleResult,
} from '../_shared/v5RuntimeCore.ts';

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

  let body: Record<string, unknown> | null = null;
  try { body = await req.json(); } catch { body = {}; }

  // Identidad REAL: service role (invocación interna) o usuario autenticado.
  const isServiceRole = token !== '' && token === service;
  let userId: string | null = null;
  let roles: string[] = [];
  const admin = createClient(url, service, { auth: { persistSession: false } });

  if (!isServiceRole && token) {
    const authed = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data, error } = await authed.auth.getClaims(token);
    if (!error && data?.claims?.sub) {
      userId = String(data.claims.sub);
      const { data: rows } = await admin.from('user_roles').select('role').eq('user_id', userId);
      roles = (rows ?? []).map((r: any) => String(r.role));
    }
  }

  const decision = decideV5Invocation({ isServiceRole, roles, userId, body });
  if (!decision.allowed) {
    return json(decision.status, { ok: false, error: decision.reason });
  }

  // Configuración del runtime (fail-closed: sin fila => todo apagado).
  const { data: cfgRow } = await admin
    .from('v5_runtime_config').select('*').eq('id', 1).maybeSingle();
  const config: V5RuntimeConfig = {
    enabled: cfgRow?.enabled === true,
    paused: cfgRow?.paused !== false,
    config_review_required: cfgRow?.config_review_required !== false,
    canary_user_ids: (cfgRow?.canary_user_ids as string[] | null) ?? null,
  };

  const repo: V5ServerRepo = {
    async readConfig() { return config; },
    async claimRequests(limit, userIds) {
      const { data, error } = await admin.rpc('claim_v5_generation_requests', {
        p_limit: limit,
        p_user_ids: userIds.length > 0 ? userIds : null,
      });
      if (error) throw new Error(error.message);
      return (data ?? []) as any[];
    },
    async loadContext(comercialId) {
      const { data: assignments, error: aErr } = await admin
        .from('building_assignments')
        .select('building_id,user_id,status')
        .eq('user_id', comercialId)
        .eq('status', 'active');
      if (aErr) throw new Error(aErr.message);
      const ids = (assignments ?? []).map((a: any) => a.building_id);
      if (ids.length === 0) return { buildings: [], mix: null, window: [], slotOccupied: false, tombstones: [] };

      const { data: buildings, error: bErr } = await admin
        .from('buildings').select('*').in('id', ids);
      if (bErr) throw new Error(bErr.message);

      const { data: tasks, error: tErr } = await admin
        .from('building_tasks')
        .select('task_key,task_code,status,generation_mode,created_at')
        .eq('user_id', comercialId)
        .eq('generation_mode', 'production')
        .order('created_at', { ascending: false })
        .limit(200);
      if (tErr) throw new Error(tErr.message);

      const rows = tasks ?? [];
      const slotOccupied = rows.some((t: any) => t.status === 'pending' || t.status === 'in_progress');
      const window = rows.slice(0, 20).map((t: any) => ({ taskKey: t.task_key, bucket: t.task_code }));
      const tombstones = rows
        .filter((t: any) => ['no_procede', 'cancelled', 'superseded'].includes(t.status))
        .map((t: any) => t.task_key);

      const { data: modeRow } = await admin
        .from('work_modes').select('*').eq('user_id', comercialId).maybeSingle();

      const mapped = mapDbToV5Context({
        comercialId,
        assignments: (assignments ?? []) as any[],
        buildings: (buildings ?? []).map((b: any) => ({
          id: b.id,
          ownership_universe_complete: b.ownership_universe_complete ?? null,
          titulares: b.titulares ?? null,
          nota_simple_estado: b.nota_simple_estado ?? null,
          identidad_verificada: b.identidad_verificada ?? null,
          evidencia_disponible: b.evidencia_disponible ?? null,
        })),
      });
      return {
        buildings: mapped.buildings,
        mix: (modeRow?.mix as any) ?? null,
        window,
        slotOccupied,
        tombstones,
      };
    },
    async commitPlan(input) {
      const { data, error } = await admin.rpc('commit_v5_generation_plan', {
        p_request_id: input.requestId,
        p_lease_token: input.leaseToken,
        p_plan: {
          comercial_id: input.comercialId,
          task_key: input.candidate.taskKey,
          task_code: input.candidate.taskCode,
          building_id: input.candidate.buildingId,
          subject_type: input.candidate.subjectType,
          subject_id: input.candidate.subjectId,
          trigger_fingerprint: input.candidate.triggerFingerprint,
          title: input.candidate.title,
          eligibility_snapshot: input.candidate.eligibilitySnapshot,
          mode_snapshot: input.modeSnapshot,
          starts_at: input.startsAt,
          due_date: input.dueDate,
          justificacion: input.candidate.reason,
        },
      });
      if (error) return null;
      const id = Array.isArray(data) ? data[0]?.id : (data as any)?.id ?? data;
      return id ? { id: String(id) } : null;
    },
    async releaseRequest(requestId, leaseToken, outcome, detail) {
      await admin.rpc('release_v5_generation_request', {
        p_request_id: requestId,
        p_lease_token: leaseToken,
        p_outcome: outcome,
        p_detail: detail,
      });
    },
  };

  // Reaper: SOLO recuperación de leases caducados, nunca generación normal.
  if (body?.reap === true) {
    const { data, error } = await admin.rpc('reap_v5_generation_leases', {});
    return json(error ? 500 : 200, { ok: !error, reaped: data ?? 0, error: error?.message ?? null });
  }

  if (!config.enabled || config.paused || config.config_review_required) {
    return json(200, {
      ok: true,
      writes: 0,
      results: [],
      reason: !config.enabled
        ? 'flag_off'
        : config.paused ? 'paused' : 'config_review',
    });
  }

  const results: V5CycleResult[] = [];
  try {
    const claimed = await repo.claimRequests(
      Math.min(Number(body?.limit ?? 10) || 10, 50),
      decision.userIds,
    );
    for (const c of claimed) {
      const res = await runServerCycle(
        c.comercial_id,
        { id: c.id, leaseToken: c.lease_token },
        repo,
        { config },
      );
      results.push(res);
      if (res.outcome !== 'inserted') {
        await repo.releaseRequest(c.id, c.lease_token, res.outcome, res.reasons.join(' | ').slice(0, 500));
      }
    }
  } catch (e) {
    return json(500, { ok: false, status: 'partial', error: (e as Error)?.message ?? String(e), results });
  }

  return json(200, {
    ok: true,
    writes: results.filter((r) => r.outcome === 'inserted').length,
    results,
  });
});
