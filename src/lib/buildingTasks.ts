import { supabase } from "@/integrations/supabase/client";

export type TaskKey =
  | "missing_phones"
  | "uncontacted_owners"
  | "missing_emails"
  | "uncatalogued"
  | "verify_catastral"
  | "check_charges"
  | "prepare_briefing"
  | "schedule_visit";

export type Priority = "high" | "medium" | "low";

export const TASK_DEFS: Record<TaskKey, {
  title: string;
  description: string;
  priority: Priority;
  icon:
    | "Phone"
    | "PhoneCall"
    | "Mail"
    | "ClipboardList"
    | "FileSearch"
    | "AlertTriangle"
    | "Brain"
    | "MapPin";
}> = {
  missing_phones: {
    title: "Conseguir teléfonos de propietarios",
    description: "Hay propietarios sin teléfono registrado en este edificio.",
    priority: "high",
    icon: "Phone",
  },
  uncontacted_owners: {
    title: "Contactar propietarios pendientes",
    description: "Quedan propietarios sin ningún contacto registrado.",
    priority: "high",
    icon: "PhoneCall",
  },
  missing_emails: {
    title: "Conseguir emails de propietarios",
    description: "Hay propietarios sin email registrado.",
    priority: "medium",
    icon: "Mail",
  },
  uncatalogued: {
    title: "Catalogar edificio",
    description: "Faltan datos clave (tipo de oportunidad, m² o nº viviendas).",
    priority: "medium",
    icon: "ClipboardList",
  },
  verify_catastral: {
    title: "Verificar datos catastrales",
    description: "Falta referencia catastral o año de construcción.",
    priority: "low",
    icon: "FileSearch",
  },
  check_charges: {
    title: "Revisar cargas y embargos",
    description: "Hay propietarios con cargas o embargos detectados.",
    priority: "high",
    icon: "AlertTriangle",
  },
  prepare_briefing: {
    title: "Preparar briefing IA",
    description: "Edificio en cartera sin briefings/llamadas previas.",
    priority: "medium",
    icon: "Brain",
  },
  schedule_visit: {
    title: "Agendar visita al edificio",
    description: "Más de 30 días en tu cartera sin visita agendada.",
    priority: "low",
    icon: "MapPin",
  },
};

export const TASK_KEYS = Object.keys(TASK_DEFS) as TaskKey[];

export async function syncBuildingTasks(buildingId: string, userId: string) {
  if (!buildingId || !userId) return;

  const [bScoreRes, buildingRes, ownersScoreRes, assignRes] = await Promise.all([
    (supabase.from("v_building_score" as any) as any)
      .select("tipo_oportunidad,m2_total,num_viviendas")
      .eq("id", buildingId)
      .maybeSingle(),
    supabase.from("buildings").select("catastro_ref,metadatos").eq("id", buildingId).maybeSingle(),
    (supabase.from("v_owner_score" as any) as any)
      .select("owner_id,telefono,email,contactos_previos")
      .eq("building_id", buildingId),
    (supabase.from("building_assignments" as any) as any)
      .select("assigned_at")
      .eq("user_id", userId)
      .eq("building_id", buildingId)
      .eq("status", "active")
      .maybeSingle(),
  ]);

  const bScore: any = bScoreRes.data ?? {};
  const building: any = buildingRes.data ?? {};
  const ownersScore: any[] = ownersScoreRes.data ?? [];
  const assignment: any = assignRes.data;

  const ownerIds = ownersScore.map((o) => o.owner_id).filter(Boolean);

  let ownersData: any[] = [];
  let callsCount = 0;
  if (ownerIds.length) {
    const [ownersFull, callsRes] = await Promise.all([
      supabase.from("owners").select("id,metadatos").in("id", ownerIds),
      supabase
        .from("calls")
        .select("id", { count: "exact", head: true })
        .in("owner_id", ownerIds),
    ]);
    ownersData = ownersFull.data ?? [];
    callsCount = callsRes.count ?? 0;
  }

  const meta = building.metadatos ?? {};
  const anio = meta.anio_construccion ?? meta.year_built ?? meta.ano_construccion ?? null;
  const isAssigned = !!assignment;
  const assignedAt = assignment?.assigned_at ? new Date(assignment.assigned_at) : null;

  const conditions: Record<TaskKey, boolean> = {
    missing_phones: ownersScore.some((o) => !o.telefono),
    uncontacted_owners: ownersScore.some((o) => (o.contactos_previos ?? 0) === 0),
    missing_emails: ownersScore.some((o) => !o.email),
    uncatalogued: !bScore.tipo_oportunidad || !bScore.m2_total || !bScore.num_viviendas,
    verify_catastral: !building.catastro_ref || !anio,
    check_charges: ownersData.some((o) => {
      const m = o.metadatos ?? {};
      return (
        m.cargas === true ||
        m.embargos === true ||
        (Array.isArray(m.cargas) && m.cargas.length > 0)
      );
    }),
    prepare_briefing: isAssigned && callsCount === 0,
    schedule_visit:
      isAssigned && !!assignedAt && Date.now() - assignedAt.getTime() > 30 * 86400_000,
  };

  const { data: existing } = await (supabase.from("building_tasks" as any) as any)
    .select("id,task_key,status")
    .eq("building_id", buildingId)
    .eq("user_id", userId)
    .eq("task_type", "auto");

  const existingByKey = new Map<string, any>();
  (existing ?? []).forEach((t: any) => existingByKey.set(t.task_key, t));

  const ops: Promise<any>[] = [];
  const nowIso = new Date().toISOString();

  for (const k of TASK_KEYS) {
    const def = TASK_DEFS[k];
    const cond = conditions[k];
    const ex = existingByKey.get(k);
    if (cond) {
      if (!ex) {
        ops.push(
          (supabase.from("building_tasks" as any) as any).insert({
            building_id: buildingId,
            user_id: userId,
            task_type: "auto",
            task_key: k,
            title: def.title,
            description: def.description,
            priority: def.priority,
            status: "pending",
          }),
        );
      } else if (ex.status === "completed") {
        ops.push(
          (supabase.from("building_tasks" as any) as any)
            .update({ status: "pending", completed_at: null })
            .eq("id", ex.id),
        );
      }
    } else if (ex && ex.status !== "completed" && ex.status !== "skipped") {
      ops.push(
        (supabase.from("building_tasks" as any) as any)
          .update({ status: "completed", completed_at: nowIso })
          .eq("id", ex.id),
      );
    }
  }

  await Promise.allSettled(ops);
}

export async function syncAssignedBuildingsTasks(userId: string) {
  if (!userId) return;
  const { data } = await (supabase.from("building_assignments" as any) as any)
    .select("building_id")
    .eq("user_id", userId)
    .eq("status", "active");
  const ids = (data ?? []).map((a: any) => a.building_id);
  await Promise.allSettled(ids.map((id: string) => syncBuildingTasks(id, userId)));
}
