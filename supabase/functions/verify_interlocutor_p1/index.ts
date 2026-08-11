// TEMPORAL — verificación operativa del bloqueo por interlocutor. Se borra tras el informe.
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const body = await req.json();
  const out: any = {};

  async function sessionFor(email: string) {
    const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    if (error) throw error;
    const c = createClient(url, anon, { auth: { persistSession: false } });
    const { data: s, error: e2 } = await c.auth.verifyOtp({
      type: "magiclink", email, token_hash: (data as any).properties.hashed_token,
    });
    if (e2) throw e2;
    return createClient(url, anon, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${s.session!.access_token}` } },
    });
  }

  const buildingId = body.building_id as string;
  const ownerId = body.owner_id as string;
  const jesus = await sessionFor("jesus@afflux.es");
  const david = await sessionFor("david.casero@afflux.es");

  // (d) comercial NO asignado
  out.david_marca = await david.rpc("set_building_interlocutor", {
    p_building_id: buildingId, p_owner_id: ownerId, p_motivo: "prueba no autorizada",
  }).then((r: any) => ({ error: r.error?.message ?? null }));

  // (b) comercial asignado marca
  out.jesus_marca = await jesus.rpc("set_building_interlocutor", {
    p_building_id: buildingId, p_owner_id: ownerId, p_motivo: "único contacto receptivo",
  }).then((r: any) => ({ data: r.data, error: r.error?.message ?? null }));

  out.david_quita = await david.rpc("clear_building_interlocutor", {
    p_building_id: buildingId,
  }).then((r: any) => ({ error: r.error?.message ?? null }));

  // (c) generaciones con bloqueo activo
  const gen = async (n: number) => {
    const res: any[] = [];
    for (let i = 0; i < n; i++) {
      const r = await fetch(`${url}/functions/v1/generate_next_task`, {
        method: "POST",
        headers: { Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_user_id: body.user_id }),
      });
      const j = await r.json();
      if (j?.created) res.push({ id: j.created.id, building: j.created.building_id, key: j.created.task_key, type: j.created.task_type });
      else res.push({ reason: j?.reason ?? j?.error });
    }
    return res;
  };
  out.bloqueado = await gen(Number(body.n ?? 8));
  out.bloqueado_otros_propietarios = out.bloqueado.filter((t: any) =>
    t.building === buildingId && t.key && !String(t.key).includes(ownerId)).length;

  // limpieza: borrar las tareas creadas por la prueba
  const ids = out.bloqueado.filter((t: any) => t.id).map((t: any) => t.id);

  // desbloqueo y nueva generación
  out.jesus_quita = await jesus.rpc("clear_building_interlocutor", {
    p_building_id: buildingId, p_motivo: "fin de la prueba",
  }).then((r: any) => ({ data: r.data, error: r.error?.message ?? null }));
  out.desbloqueado = await gen(Number(body.n2 ?? 3));
  const ids2 = out.desbloqueado.filter((t: any) => t.id).map((t: any) => t.id);

  if (body.cleanup !== false) {
    await admin.from("building_tasks").delete().in("id", [...ids, ...ids2]);
  }

  const { data: hist } = await admin.from("building_interlocutor_history")
    .select("accion, owner_id, actor_id, motivo, created_at")
    .eq("building_id", buildingId).order("created_at", { ascending: false }).limit(5);
  out.historial = hist;

  return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json" } });
});
